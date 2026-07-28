import { BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  attachRoomSource,
  detachRoomSource,
  discoverMachineSkillsWithDiagnostics,
  ensurePersonalRoom,
  executeRecordedRun,
  loadAgents,
  normalizeProviderId,
  readRoomTextFile,
  withCurrentScanSnapshot,
  setActiveRoomSource,
  toWorkspaceLocation,
  touchRoom,
  writeScanData,
  type RoomRecord
} from '@room/engine';
import {
  bindCurrentRoom,
  mutateBoundRoom,
  requireBoundRoom,
  requireBoundSource,
  requireBoundWorkspace,
  resolveWithinProject,
  readRoomSkillReferences,
  sanitizeWorkspaceRelativePath
} from './shared.js';
import { browseWorkspaceFiles, listWorkspaceFiles } from './workspace-files.js';
import { readWorkspaceFilePreview } from './workspace-preview.js';
import { searchContextItems } from './workspace-context.js';
import { loadTeamsWithDiagnostics } from './team-store.js';
import { readProvidersFromDisk } from './provider-store.js';
import { getPinnedGitStatus, scanPinnedSource } from './pinned-source.js';
import { assertJsonBytes, assertUtf8Bytes } from './ipc-limits.js';
import { toPublicError } from './public-error.js';
import { listRoomArtifactPage } from './room-artifact-pages.js';
import { listRoomTaskRunPage } from './task-run-pages.js';
import { reconcilePendingMemberDeletions } from './member-deletion.js';
import { reconcileTeamTransactions } from './team-store-transaction.js';

function summarizeRoom(record: RoomRecord) {
  return {
    id: record.manifest.id,
    name: record.manifest.name,
    activeSourceId: record.manifest.activeSourceId,
    sources: record.manifest.sources.map(source => ({
      id: source.id,
      name: source.name,
      attachedAt: source.attachedAt
    }))
  };
}

function dedupeDiscussionSummaryFiles(files: string[]): string[] {
  const byDiscussion = new Map<string, string>();
  const ordinary: string[] = [];
  for (const file of files) {
    const match = file.match(/^(.*)-((?:discussion)-[A-Za-z0-9_-]+)-summary\.md$/);
    if (!match) {
      ordinary.push(file);
      continue;
    }
    const current = byDiscussion.get(match[2]);
    if (!current || file.length < current.length) byDiscussion.set(match[2], file);
  }
  return [...ordinary, ...byDiscussion.values()].sort((a, b) => a.localeCompare(b));
}

async function loadRoomData(roomId: string) {
  await reconcilePendingMemberDeletions(roomId);
  await reconcileTeamTransactions(roomId);
  const record = requireBoundRoom(roomId);
  const workspace = toWorkspaceLocation(record);
  const readOptionalContext = (filename: string) => readRoomTextFile(
    workspace,
    ['context', filename],
    1024 * 1024
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const [projectMd, archMd] = await Promise.all([
    readOptionalContext('overview.md'),
    readOptionalContext('structure.md')
  ]);
  const hasScanData = workspace.sourceId
    ? await withCurrentScanSnapshot(workspace, async scanSnapshot => (
        fs.stat(resolveWithinProject(scanSnapshot, 'project-map.json'))
          .then(stat => stat.isFile())
          .catch(() => false)
      )) || false
    : false;
  const [taskPage, taskRunPage] = await Promise.all([
    listRoomArtifactPage(roomId, 'tasks'),
    listRoomTaskRunPage(roomId)
  ]);

  const [agents, teamLoadResult, providers, machineSkillResult] = await Promise.all([
    loadAgents(workspace),
    loadTeamsWithDiagnostics(roomId),
    readProvidersFromDisk(),
    discoverMachineSkillsWithDiagnostics()
  ]);
  const configuredIds = new Set(providers.filter(provider => provider.apiKey).map(provider => provider.id));
  const localProvider = providers.find(provider => provider.id === 'ollama')
    || providers.find(provider => provider.id === 'lmstudio');
  const fallbackProvider: { id: string } | null = localProvider
      ? { id: localProvider.id }
      : configuredIds.has('gemini')
        ? { id: 'gemini' }
        : configuredIds.has('anthropic')
          ? { id: 'anthropic' }
          : configuredIds.has('openai')
            ? { id: 'openai' }
            : null;
  const updatedAgents = agents.map(agent => {
    if (!agent.isVirtual || !fallbackProvider) return agent;
    const configured = configuredIds.has(normalizeProviderId(agent.provider))
      || normalizeProviderId(agent.provider) === localProvider?.id;
    if (configured) return agent;
    return {
      ...agent,
      provider: fallbackProvider.id,
      modelName: agent.modelName
    };
  });
  const assigned = new Set(teamLoadResult.teams.flatMap(team => team.memberIds));
  const [decisions, reviews, documents, discussions] = await Promise.all([
    listRoomArtifactPage(roomId, 'decisions'),
    listRoomArtifactPage(roomId, 'reviews'),
    listRoomArtifactPage(roomId, 'documents'),
    listRoomArtifactPage(roomId, 'discussions')
  ]);
  const response = {
    success: true,
    room: summarizeRoom(record),
    projectMd,
    archMd,
    hasScanData,
    workspaceDiagnostics: teamLoadResult.diagnostics.map(item => ({
      source: path.basename(item.filePath),
      message: 'Team configuration could not be loaded.'
    })),
    tasks: taskPage.files,
    taskRuns: taskRunPage.taskRuns,
    decisions: decisions.files,
    reviews: reviews.files,
    documents: dedupeDiscussionSummaryFiles(documents.files),
    discussions: discussions.files,
    skills: await readRoomSkillReferences(roomId),
    machineSkills: machineSkillResult.skills,
    machineSkillsTruncated: machineSkillResult.truncated,
    // `strategy` (up to 32KB per member) is unused by the renderer — task and
    // discussion execution re-reads the full member config from disk via
    // loadAgents rather than trusting this cached snapshot — so it is the
    // heaviest field the Home listing can drop without losing anything the UI
    // reads. `systemPrompt` stays: the AI member editor seeds its form
    // straight from this payload (see agentEditorState.ts) with no separate
    // full-member fetch, so truncating it here would risk saving a corrupted
    // prompt back to disk.
    agents: updatedAgents.map(agent => {
      const homeAgent = { ...agent };
      delete homeAgent.strategy;
      return homeAgent;
    }),
    teams: teamLoadResult.teams,
    unassignedMemberIds: updatedAgents
      .filter(agent => !agent.isVirtual && agent.id && !assigned.has(agent.id))
      .map(agent => agent.id),
    artifactListPagination: {
      tasks: pageState(taskPage),
      decisions: pageState(decisions),
      reviews: pageState(reviews),
      documents: pageState(documents),
      discussions: pageState(discussions)
    },
    taskRunPagination: pageState(taskRunPage)
  };
  assertJsonBytes(response, 'Home data', 16 * 1024 * 1024);
  return response;
}

function pageState(page: {
  hasMore: boolean;
  nextCursor?: string;
  truncated: boolean;
}) {
  return {
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    truncated: page.truncated
  };
}

export function registerWorkspaceIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('initialize-personal-room', async () => {
    try {
      const record = await ensurePersonalRoom();
      bindCurrentRoom(record);
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error, 'ROOM could not initialize.') };
    }
  });

  ipcMain.handle('attach-room-source', async (_event, { roomId }: { roomId: string }) => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow) return { success: false, error: 'ROOM window is unavailable.' };
      const selection = await dialog.showOpenDialog(mainWindow, {
        title: 'Attach Source folder',
        buttonLabel: 'Attach Source',
        properties: ['openDirectory']
      });
      if (selection.canceled || selection.filePaths.length === 0) return { success: true, canceled: true };
      const record = await mutateBoundRoom(
        roomId,
        current => attachRoomSource(current, selection.filePaths[0])
      );
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error, 'ROOM could not attach that Source.') };
    }
  });

  ipcMain.handle('detach-room-source', async (
    _event,
    { roomId, sourceId }: { roomId: string; sourceId: string }
  ) => {
    try {
      const record = await mutateBoundRoom(
        roomId,
        current => detachRoomSource(current, sourceId)
      );
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('set-active-room-source', async (
    _event,
    { roomId, sourceId }: { roomId: string; sourceId?: string }
  ) => {
    try {
      const record = await mutateBoundRoom(
        roomId,
        current => setActiveRoomSource(current, sourceId)
      );
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('get-room-data', async (_event, roomId: string) => {
    try {
      return await loadRoomData(roomId);
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error, 'ROOM data could not be loaded.') };
    }
  });

  ipcMain.handle('list-source-files', async (
    _event,
    { roomId, sourceId }: { roomId: string; sourceId: string }
  ) => {
    try {
      const source = requireBoundSource(roomId, sourceId);
      const { files, truncated } = await listWorkspaceFiles(source);
      return { success: true, files, truncated };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('browse-source-files', async (
    _event,
    payload: { roomId: string; sourceId: string; directory?: string; query?: string }
  ) => {
    try {
      const source = requireBoundSource(payload.roomId, payload.sourceId);
      assertUtf8Bytes(payload.directory || '', 'Source directory', 4_096);
      assertUtf8Bytes(payload.query || '', 'Search query', 512);
      const directory = payload.directory?.trim()
        ? sanitizeWorkspaceRelativePath(payload.directory)
        : '';
      return {
        success: true,
        ...await browseWorkspaceFiles(source, directory, payload.query || '')
      };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('search-context-items', async (
    _event,
    { roomId, sourceId, query }: { roomId: string; sourceId?: string; query?: string }
  ) => {
    try {
      assertUtf8Bytes(query || '', 'Search query', 512);
      const source = sourceId ? requireBoundSource(roomId, sourceId) : undefined;
      return {
        success: true,
        items: await searchContextItems(roomId, source, query || '')
      };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('read-source-file', async (
    _event,
    { roomId, sourceId, filePath }: { roomId: string; sourceId: string; filePath: string }
  ) => {
    try {
      assertUtf8Bytes(filePath, 'Source file path', 4_096);
      return await readWorkspaceFilePreview(requireBoundSource(roomId, sourceId), filePath);
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('get-source-git-status', async (
    _event,
    { roomId, sourceId }: { roomId: string; sourceId: string }
  ) => {
    try {
      const git = await getPinnedGitStatus(requireBoundSource(roomId, sourceId));
      return { success: true, git };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('run-scan', async (
    _event,
    payload: {
      roomId: string;
      sourceId: string;
    }
  ) => {
    try {
      const source = requireBoundSource(payload.roomId, payload.sourceId);
      const workspace = requireBoundWorkspace(payload.roomId, payload.sourceId);
      await executeRecordedRun(workspace, 'scan', payload.sourceId, async () => {
        const scan = await scanPinnedSource(source);
        await writeScanData(workspace, scan);
        await mutateBoundRoom(payload.roomId, touchRoom);
      });
      return { success: true, message: 'Source scan complete.' };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });
}
