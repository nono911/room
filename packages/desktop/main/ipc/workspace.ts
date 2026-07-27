import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  attachRoomSource,
  detachRoomSource,
  discoverMachineSkills,
  ensurePersonalRoom,
  loadAgents,
  normalizeProviderId,
  scanDirectory,
  setActiveRoomSource,
  toWorkspaceLocation,
  touchRoom,
  writeScanData,
  type AgentConfig,
  type RoomRecord
} from '@room/engine';
import {
  SUPPORTED_LOCAL_CLI_PRESETS_SET,
  WORKSPACE_FILE_LIMIT,
  bindCurrentRoom,
  requireBoundProjectRoot,
  requireBoundRoom,
  requireBoundWorkspace,
  resolveCanonicalWithinProject,
  resolveWithinProject,
  resolveWithinRoomData,
  safeReadDir,
  readFirstExistingFile,
  readMergedDirs,
  sanitizeWorkspaceRelativePath
} from './shared.js';
import { browseWorkspaceFiles, listWorkspaceFiles } from './workspace-files.js';
import { readWorkspaceFilePreview } from './workspace-preview.js';
import { searchContextItems } from './workspace-context.js';
import { loadTeamsWithDiagnostics } from './team-store.js';
import { detectLocalAgents, LocalCliProvider, normalizeLocalCliModelName } from '@room/engine';
import { applyApiKeysToEnvironment, readProvidersFromDisk } from './provider-store.js';
import { readProjectConfigFromDisk } from './config-store.js';

function summarizeRoom(record: RoomRecord) {
  return {
    id: record.manifest.id,
    name: record.manifest.name,
    activeSourceId: record.manifest.activeSourceId,
    sources: record.manifest.sources.map(source => ({
      id: source.id,
      name: source.name,
      path: source.path,
      attachedAt: source.attachedAt
    }))
  };
}

function dedupeDiscussionSummaryFiles(files: string[]): string[] {
  const byDiscussion = new Map<string, string>();
  const ordinary: string[] = [];
  for (const file of files) {
    const match = file.match(/^(.*)-((?:discussion)-\d+)-summary\.md$/);
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
  const record = requireBoundRoom(roomId);
  const workspace = toWorkspaceLocation(record);
  const roomRoot = record.roomRoot;
  const projectMd = await readFirstExistingFile([
    resolveWithinProject(roomRoot, 'context', 'overview.md')
  ]);
  const archMd = await readFirstExistingFile([
    resolveWithinProject(roomRoot, 'context', 'structure.md')
  ]);
  const hasScanData = await fs.stat(resolveWithinProject(roomRoot, 'context', 'project-map.json'))
    .then(stat => stat.isFile())
    .catch(() => false);
  const tasksDir = resolveWithinProject(roomRoot, 'tasks');
  const taskFiles = (await safeReadDir(tasksDir)).filter(file => file.toLowerCase().endsWith('.md'));
  const rawTaskRuns = taskFiles
    .filter(file => /^task-[\w-]+\.md$/i.test(file) && !file.toLowerCase().endsWith('-artifact.md'))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
  const taskRuns = await Promise.all(rawTaskRuns.map(async filename => {
    try {
      const raw = await fs.readFile(path.join(tasksDir, filename.replace(/\.md$/i, '.json')), 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      return {
        filename,
        id: data.id || filename.replace(/\.md$/i, ''),
        title: data.title || filename.replace(/\.md$/i, ''),
        status: data.status || 'unknown',
        cycles: data.cycles || 0,
        statusSummary: data.statusSummary || '',
        associatedCardId: data.associatedCardId || '',
        sourceProvenance: data.sourceProvenance
      };
    } catch {
      return {
        filename,
        id: filename.replace(/\.md$/i, ''),
        title: filename.replace(/\.md$/i, ''),
        status: 'unknown',
        cycles: 0
      };
    }
  }));

  const [agents, teamLoadResult, providers, detectedClis, machineSkills] = await Promise.all([
    loadAgents(workspace),
    loadTeamsWithDiagnostics(roomId),
    readProvidersFromDisk(),
    detectLocalAgents(),
    discoverMachineSkills({ forceRefresh: true })
  ]);
  const activeCli = detectedClis.find(cli => cli.available);
  const configuredIds = new Set(providers.filter(provider => provider.apiKey).map(provider => provider.id));
  const localProvider = providers.find(provider => provider.id === 'ollama')
    || providers.find(provider => provider.id === 'lmstudio');
  const fallbackProvider: { id: string; cliPreset?: AgentConfig['cliPreset'] } | null = activeCli
    ? { id: 'Local CLI', cliPreset: activeCli.id as AgentConfig['cliPreset'] }
    : localProvider
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
      cliPreset: fallbackProvider.cliPreset,
      modelName: fallbackProvider.id === 'Local CLI' ? undefined : agent.modelName
    };
  });
  const assigned = new Set(teamLoadResult.teams.flatMap(team => team.memberIds));
  return {
    success: true,
    room: summarizeRoom(record),
    projectMd,
    archMd,
    hasScanData,
    workspaceDiagnostics: teamLoadResult.diagnostics.map(item => ({
      source: item.filePath,
      message: item.error
    })),
    tasks: taskFiles.filter(file => !/^task-[\w-]+\.md$/i.test(file) && !file.endsWith('-artifact.md')),
    taskRuns,
    decisions: await safeReadDir(resolveWithinProject(roomRoot, 'decisions')),
    reviews: await safeReadDir(resolveWithinProject(roomRoot, 'reviews')),
    documents: dedupeDiscussionSummaryFiles(await safeReadDir(resolveWithinProject(roomRoot, 'documents'))),
    discussions: (await safeReadDir(resolveWithinProject(roomRoot, 'discussions')))
      .filter(file => file.endsWith('.md')),
    skills: await readMergedDirs([
      resolveWithinProject(roomRoot, 'skills'),
      resolveWithinProject(roomRoot, 'roles')
    ]),
    machineSkills,
    agents: updatedAgents,
    teams: teamLoadResult.teams,
    unassignedMemberIds: updatedAgents
      .filter(agent => !agent.isVirtual && agent.id && !assigned.has(agent.id))
      .map(agent => agent.id)
  };
}

export function registerWorkspaceIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('initialize-personal-room', async () => {
    try {
      const record = await ensurePersonalRoom();
      bindCurrentRoom(record);
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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
      const record = await attachRoomSource(requireBoundRoom(roomId), selection.filePaths[0]);
      bindCurrentRoom(record);
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('detach-room-source', async (
    _event,
    { roomId, sourceId }: { roomId: string; sourceId: string }
  ) => {
    try {
      const record = await detachRoomSource(requireBoundRoom(roomId), sourceId);
      bindCurrentRoom(record);
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('set-active-room-source', async (
    _event,
    { roomId, sourceId }: { roomId: string; sourceId?: string }
  ) => {
    try {
      const record = await setActiveRoomSource(requireBoundRoom(roomId), sourceId);
      bindCurrentRoom(record);
      return { success: true, room: summarizeRoom(record) };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('get-room-data', async (_event, roomId: string) => {
    try {
      return await loadRoomData(roomId);
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('list-source-files', async (
    _event,
    { roomId, sourceId }: { roomId: string; sourceId: string }
  ) => {
    try {
      const sourceRoot = requireBoundProjectRoot(roomId, sourceId);
      const files = await listWorkspaceFiles(sourceRoot);
      return { success: true, files, truncated: files.length >= WORKSPACE_FILE_LIMIT };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('browse-source-files', async (
    _event,
    payload: { roomId: string; sourceId: string; directory?: string; query?: string }
  ) => {
    try {
      const sourceRoot = requireBoundProjectRoot(payload.roomId, payload.sourceId);
      const directory = payload.directory?.trim()
        ? sanitizeWorkspaceRelativePath(payload.directory)
        : '';
      return {
        success: true,
        ...await browseWorkspaceFiles(sourceRoot, directory, payload.query?.slice(0, 160) || '')
      };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('search-context-items', async (
    _event,
    { roomId, sourceId, query }: { roomId: string; sourceId?: string; query?: string }
  ) => {
    try {
      const sourceRoot = sourceId ? requireBoundProjectRoot(roomId, sourceId) : undefined;
      return { success: true, items: await searchContextItems(roomId, sourceRoot, query || '') };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('read-source-file', async (
    _event,
    { roomId, sourceId, filePath }: { roomId: string; sourceId: string; filePath: string }
  ) => {
    try {
      return await readWorkspaceFilePreview(requireBoundProjectRoot(roomId, sourceId), filePath);
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('reveal-source-file', async (
    _event,
    { roomId, sourceId, filePath }: { roomId: string; sourceId: string; filePath: string }
  ) => {
    try {
      const sourceRoot = requireBoundProjectRoot(roomId, sourceId);
      const target = await resolveCanonicalWithinProject(sourceRoot, sanitizeWorkspaceRelativePath(filePath));
      shell.showItemInFolder(target);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('run-scan', async (
    _event,
    payload: {
      roomId: string;
      sourceId: string;
      mainAgent?: string;
      modelName?: string;
      allowDangerousCli?: boolean;
    }
  ) => {
    try {
      await applyApiKeysToEnvironment();
      const sourceRoot = requireBoundProjectRoot(payload.roomId, payload.sourceId);
      const workspace = requireBoundWorkspace(payload.roomId, payload.sourceId);
      await writeScanData(workspace, await scanDirectory(sourceRoot));
      const config = await readProjectConfigFromDisk(payload.roomId);
      const preset = payload.mainAgent && SUPPORTED_LOCAL_CLI_PRESETS_SET.has(payload.mainAgent)
        ? payload.mainAgent
        : 'none';
      if (preset !== 'none') {
        const provider = new LocalCliProvider({
          cliPreset: preset as AgentConfig['cliPreset'],
          cwd: sourceRoot,
          roomRoot: workspace.roomRoot,
          modelName: normalizeLocalCliModelName(payload.modelName),
          permissionMode: payload.allowDangerousCli && config.allowDangerousCli ? 'dangerous' : 'safe'
        });
        const summary = await provider.execute(
          'Review this Source and produce a concise Markdown overview. Do not modify files.',
          'You are the ROOM source scanner. Return Markdown only.'
        );
        if (summary.trim()) {
          await fs.writeFile(resolveWithinRoomData(payload.roomId, 'context', 'overview.md'), summary, 'utf-8');
        }
      }
      const touched = await touchRoom(requireBoundRoom(payload.roomId));
      bindCurrentRoom(touched);
      return { success: true, message: 'Source scan complete.' };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
