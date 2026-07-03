import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { DiscussionEngine, loadAgents, loadTaskBoard, validateAgentConfig, type AgentConfig } from '@room/engine';
import {
  ROOM_DIR, DISCUSSION_CONTEXT_FILE_LIMIT_BYTES, DISCUSSION_CONTEXT_TOTAL_LIMIT,
  requireBoundProjectRoot, resolveWithinProject,
  sanitizeFileName, sanitizeWorkspaceRelativePath, readFirstExistingFile
} from './shared.js';
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
        content = await readTextFileWithLimitLocal(
          resolveWithinProject(projectRoot, relPath),
          DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
        );
      } else if (ref.startsWith('document:')) {
        const filename = sanitizeFileName(ref.slice('document:'.length));
        label = `Document: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinProject(projectRoot, ROOM_DIR, 'documents', filename),
          resolveWithinProject(projectRoot, ROOM_DIR, 'reviews', filename),
          resolveWithinProject(projectRoot, ROOM_DIR, 'decisions', filename)
        ]);
      } else if (ref.startsWith('task:')) {
        const filename = sanitizeFileName(ref.slice('task:'.length));
        label = `Task: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinProject(projectRoot, ROOM_DIR, 'tasks', filename)
        ]);
      } else if (ref.startsWith('discussion:')) {
        const filename = sanitizeFileName(ref.slice('discussion:'.length));
        if (!filename.toLowerCase().endsWith('.md')) {
          throw new Error('Only markdown discussion transcripts can be included as context.');
        }
        label = `Previous Discussion: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinProject(projectRoot, ROOM_DIR, 'discussions', filename)
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

function normalizeTemporaryAgents(rawAgents: unknown): AgentConfig[] {
  if (!Array.isArray(rawAgents)) return [];
  return rawAgents
    .slice(0, 12)
    .map(rawAgent => validateAgentConfig(rawAgent))
    .filter((result): result is { success: true; agent: AgentConfig } => result.success)
    .map(result => result.agent);
}

export function registerTasksIpc(): void {
  ipcMain.handle('run-task', async (event, { dirPath, task, taskType, doerName, reviewerNames, maxCycles, contextRefs, associatedCardId, continuedFromTaskId, taskId, temporaryAgents }: { dirPath: string; task: string; taskType?: string; doerName?: string; reviewerNames?: string[]; maxCycles?: number; contextRefs?: string[]; associatedCardId?: string; continuedFromTaskId?: string; taskId?: string; temporaryAgents?: unknown[] }) => {
    const actualTaskId = taskId || (associatedCardId ? `task-${associatedCardId}` : `task-${Date.now()}`);
    const cycleLimit = Number.isFinite(maxCycles) ? Math.max(1, Math.min(5, Math.floor(maxCycles || 1))) : 2;
    const sendDiscussionEvent = (payload: any) => {
      event.sender.send('discussion-event', payload);
    };
    startControlledRun(actualTaskId);

    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const engine = new DiscussionEngine(projectRoot, { providerRegistry: await readProvidersFromDisk() });
      await applyApiKeysToEnvironment();
      const safeTemporaryAgents = normalizeTemporaryAgents(temporaryAgents);
      const agents = [...safeTemporaryAgents, ...await loadAgents(projectRoot)];
      const doer = doerName
        ? agents.find(agent => agent.name.toLowerCase() === doerName.toLowerCase())
        : agents.find(agent => {
            const text = `${agent.name} ${agent.role}`.toLowerCase();
            return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('writer') || text.includes('researcher') || text.includes('designer') || text.includes('producer');
          });

      if (!doer) {
        return { success: false, error: 'Select a Doer AI member before running the task.' };
      }

      const additionalContext = await buildDiscussionContext(projectRoot, contextRefs);
      const result = await engine.runCodingTask(
        actualTaskId,
        `Task: ${task.slice(0, 40)}...`,
        task,
        doer.name,
        reviewerNames || [],
        cycleLimit,
        {
          onEvent: sendDiscussionEvent,
          additionalContext,
          taskType,
          getInterruptMessage: () => getRunInterruptMessage(actualTaskId),
          associatedCardId,
          continuedFromTaskId,
          temporaryAgents: safeTemporaryAgents
        }
      );

      return { success: true, result };
    } catch (error: any) {
      sendDiscussionEvent({
        type: 'discussion_failed',
        discussionId: taskId,
        error: error.message
      });
      return { success: false, error: error.message };
    } finally {
      finishControlledRun(actualTaskId);
    }
  });

  ipcMain.handle('load-task-board', async (event, { dirPath }: { dirPath: string }) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const board = await loadTaskBoard(projectRoot);
      return { success: true, cards: board.cards };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
