import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DiscussionEngine, loadAgents, validateAgentConfig, type AgentConfig } from '@room/engine';
import {
  DISCUSSION_CONTEXT_FILE_LIMIT_BYTES, DISCUSSION_CONTEXT_TOTAL_LIMIT,
  requireBoundProjectRoot, requireBoundWorkspace, resolveWithinProject, resolveWithinRoomData,
  sanitizeFileName, sanitizeWorkspaceRelativePath, readFirstExistingFile,
} from './shared.js';
import { readProjectConfigFromDisk, type ProjectConfig } from './config-store.js';
import { readProvidersFromDisk, applyApiKeysToEnvironment } from './provider-store.js';
import { finishControlledRun, getRunInterruptMessage, startControlledRun } from './run-control.js';

function normalizeContextRef(rawRef: unknown): string | null {
  if (typeof rawRef !== 'string') return null;
  const ref = rawRef.trim();
  if (!ref) return null;
  return ref;
}

async function readTextFileWithLimitLocal(filePath: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('Selected item is not a file.');
  }
  if (stat.size > maxBytes) {
    throw new Error('File is too large to include as discussion context.');
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) {
    throw new Error('Binary files cannot be included as discussion context.');
  }
  return buffer.toString('utf-8');
}

async function buildDiscussionContext(projectRoot: string, rawRefs: unknown): Promise<string> {
  if (!Array.isArray(rawRefs)) return '';

  const sections: string[] = [];
  let totalBytes = 0;

  for (const rawRef of rawRefs) {
    const ref = normalizeContextRef(rawRef);
    if (!ref) continue;

    let label = ref;
    let content = '';
    try {
      if (ref === 'workspace:overview') {
        continue;
      } else if (ref === 'workspace:structure') {
        continue;
      } else if (ref.startsWith('file:')) {
        const relPath = sanitizeWorkspaceRelativePath(ref.slice('file:'.length));
        label = `Workspace File: ${relPath}`;
        const selectedPath = relPath.startsWith('.room/')
          ? resolveWithinRoomData(projectRoot, relPath.slice('.room/'.length))
          : resolveWithinProject(projectRoot, relPath);
        content = await readTextFileWithLimitLocal(
          selectedPath,
          DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
        );
      } else if (ref.startsWith('document:')) {
        const filename = sanitizeFileName(ref.slice('document:'.length));
        label = `Document: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinRoomData(projectRoot, 'documents', filename),
          resolveWithinRoomData(projectRoot, 'reviews', filename),
          resolveWithinRoomData(projectRoot, 'decisions', filename)
        ]);
      } else if (ref.startsWith('task:')) {
        const filename = sanitizeFileName(ref.slice('task:'.length));
        label = `Task: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinRoomData(projectRoot, 'tasks', filename)
        ]);
      } else if (ref.startsWith('discussion:')) {
        const filename = sanitizeFileName(ref.slice('discussion:'.length));
        if (!filename.toLowerCase().endsWith('.md')) {
          throw new Error('Only markdown discussion transcripts can be included as context.');
        }
        label = `Previous Discussion: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinRoomData(projectRoot, 'discussions', filename)
        ]);
      }
    } catch (error: any) {
      content = `[Unable to include context: ${error.message}]`;
    }

    if (!content.trim()) continue;

    const section = `\n\n---\n## ${label}\n\n${content.trim()}`;
    totalBytes += Buffer.byteLength(section, 'utf-8');
    if (totalBytes > DISCUSSION_CONTEXT_TOTAL_LIMIT) {
      sections.push('\n\n---\n## Context Limit\n\nAdditional selected context was omitted because the context bundle reached the size limit.');
      break;
    }
    sections.push(section);
  }

  return sections.join('');
}

function createProjectSummaryAgent(projectConfig: ProjectConfig): AgentConfig | undefined {
  if (!projectConfig.mainAgent || projectConfig.mainAgent === 'none') {
    return undefined;
  }

  return {
    name: 'Project Summary Agent',
    role: 'Room Reporter',
    provider: 'Local CLI',
    modelName: projectConfig.modelName || undefined,
    systemPrompt: `You are the Room Reporter for this workspace.

Your job is to turn chat transcripts into durable workspace memory.
Do not contribute new ideas. Capture what was decided, what remains open, useful context, risks, options, and next steps.
Use the same natural language as the chat unless the user explicitly asks otherwise.`,
    cliPreset: projectConfig.mainAgent as AgentConfig['cliPreset'],
    stdinFormat: 'text',
    permissionMode: 'safe'
  };
}

function normalizeTemporaryAgents(rawAgents: unknown): AgentConfig[] {
  if (!Array.isArray(rawAgents)) return [];
  return rawAgents
    .slice(0, 12)
    .map(rawAgent => validateAgentConfig(rawAgent))
    .filter((result): result is { success: true; agent: AgentConfig } => result.success)
    .map(result => result.agent);
}

export function registerDiscussionsIpc(): void {
  ipcMain.handle('run-discussion', async (event, { dirPath, topic, agentNames, maxRounds, reviewMode, allowReadOnlyTools, contextRefs, discussionId: requestedDiscussionId, qualityGate, moderatorName, autoSummary, summaryAgentName, useProjectSummaryAgent, temporaryAgents }: { dirPath: string; topic: string; agentNames?: string[]; maxRounds?: number; reviewMode?: boolean; allowReadOnlyTools?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; moderatorName?: string; autoSummary?: boolean; summaryAgentName?: string; useProjectSummaryAgent?: boolean; temporaryAgents?: unknown[] }) => {
    const safeRequestedDiscussionId = typeof requestedDiscussionId === 'string' && /^discussion-\d+$/.test(requestedDiscussionId)
      ? requestedDiscussionId
      : '';
    const discussionId = safeRequestedDiscussionId || `discussion-${Date.now()}`;
    const roundLimit = Number.isFinite(maxRounds) ? Math.max(1, Math.min(10, Math.floor(maxRounds || 1))) : 2;
    const sendDiscussionEvent = (payload: any) => {
      event.sender.send('discussion-event', payload);
    };
    startControlledRun(discussionId);
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const workspace = requireBoundWorkspace(dirPath);
      const engine = new DiscussionEngine(workspace, { providerRegistry: await readProvidersFromDisk() });
      await applyApiKeysToEnvironment();
      const additionalContext = await buildDiscussionContext(projectRoot, contextRefs);
      const safeTemporaryAgents = normalizeTemporaryAgents(temporaryAgents);
      let log = await engine.runDiscussion(
        discussionId,
        `Discussion: ${topic.slice(0, 30)}...`,
        topic,
        agentNames && agentNames.length > 0 ? agentNames : [],
        roundLimit,
        {
          onEvent: sendDiscussionEvent,
          reviewMode: !!reviewMode,
          allowReadOnlyTools: !!allowReadOnlyTools,
          additionalContext,
          temporaryAgents: safeTemporaryAgents,
          getInterruptMessage: () => getRunInterruptMessage(discussionId)
        }
      );

      const moderatorActions: Array<{ type: 'task' | 'adr'; id?: string; title?: string; filename?: string }> = [];

      if (qualityGate && log.status !== 'interrupted') {
        const verdict = await engine.evaluateDiscussion(discussionId, moderatorName);
        if (verdict.executed) {
          moderatorActions.push(
            ...verdict.executed.createdTaskCards.map(card => ({ type: 'task' as const, id: card.id, title: card.title })),
            ...verdict.executed.createdAdrs.map(adr => ({ type: 'adr' as const, id: adr.id, filename: adr.filename }))
          );
        }

        const discussionsDir = resolveWithinRoomData(projectRoot, 'discussions');
        const finalLogPath = resolveWithinProject(discussionsDir, `${discussionId}.json`);
        try {
          log = JSON.parse(await fs.readFile(finalLogPath, 'utf-8'));
        } catch {}
      }

      let summary: { filename: string; content: string } | undefined;
      if (autoSummary && log.status !== 'interrupted') {
        const projectConfig = await readProjectConfigFromDisk(projectRoot);
        const projectSummaryAgent = useProjectSummaryAgent ? createProjectSummaryAgent(projectConfig) : undefined;
        const summaryAgentNames = summaryAgentName
          ? [summaryAgentName]
          : (useProjectSummaryAgent ? [] : (agentNames || []));
        summary = await engine.summarizeDiscussion(
          discussionId,
          summaryAgentNames,
          projectSummaryAgent
        );
      }

      return { success: true, log, summary, moderatorActions };
    } catch (error: any) {
      sendDiscussionEvent({
        type: 'discussion_failed',
        discussionId,
        error: error.message
      });
      return { success: false, error: error.message };
    } finally {
      finishControlledRun(discussionId);
    }
  });

  ipcMain.handle('summarize-discussion', async (event, { dirPath, discussionId, agentNames, summaryAgentName, useProjectSummaryAgent }: { dirPath: string; discussionId: string; agentNames?: string[]; summaryAgentName?: string; useProjectSummaryAgent?: boolean }) => {
    try {
      await applyApiKeysToEnvironment();
      const projectRoot = requireBoundProjectRoot(dirPath);
      const workspace = requireBoundWorkspace(dirPath);
      const safeDiscussionId = typeof discussionId === 'string' && /^discussion-\d+$/.test(discussionId)
        ? discussionId
        : '';
      if (!safeDiscussionId) {
        return { success: false, error: 'Invalid discussion id.' };
      }

      const engine = new DiscussionEngine(workspace, { providerRegistry: await readProvidersFromDisk() });
      const projectConfig = await readProjectConfigFromDisk(projectRoot);
      const projectSummaryAgent = useProjectSummaryAgent ? createProjectSummaryAgent(projectConfig) : undefined;
      const summaryAgentNames = summaryAgentName
        ? [summaryAgentName]
        : (useProjectSummaryAgent ? [] : (agentNames || []));
      const summary = await engine.summarizeDiscussion(safeDiscussionId, summaryAgentNames, projectSummaryAgent);
      return { success: true, ...summary };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('generate-tasks-from-discussion', async (event, { dirPath, discussionId, moderatorName }: { dirPath: string; discussionId: string; moderatorName?: string }) => {
    try {
      await applyApiKeysToEnvironment();
      const projectRoot = requireBoundProjectRoot(dirPath);
      const workspace = requireBoundWorkspace(dirPath);
      const safeDiscussionId = typeof discussionId === 'string' && /^discussion-\d+$/.test(discussionId)
        ? discussionId
        : '';
      if (!safeDiscussionId) {
        return { success: false, error: 'Invalid discussion id.' };
      }

      const engine = new DiscussionEngine(workspace, { providerRegistry: await readProvidersFromDisk() });
      const result = await engine.generateTasksFromDiscussion(safeDiscussionId, moderatorName);
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
