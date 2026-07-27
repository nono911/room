import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { DiscussionEngine, loadAgents, loadTaskBoard, type AgentConfig } from '@room/engine';
import {
  DISCUSSION_CONTEXT_FILE_LIMIT_BYTES, DISCUSSION_CONTEXT_TOTAL_LIMIT,
  normalizeTemporaryAgents,
  createSourceProvenance, requireBoundRoom, requireBoundWorkspace, resolveCanonicalWithinProject,
  resolveWithinProject, resolveWithinRoomData,
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

async function buildDiscussionContext(
  roomId: string,
  sourceRoot: string | undefined,
  rawRefs: unknown
): Promise<string> {
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
        label = `Source File: ${relPath}`;
        const selectedPath = relPath.startsWith('.room/')
          ? resolveWithinRoomData(roomId, relPath.slice('.room/'.length))
          : sourceRoot
            ? await resolveCanonicalWithinProject(sourceRoot, relPath)
            : (() => { throw new Error('Attach a Source to include source files.'); })();
        content = await readTextFileWithLimitLocal(
          selectedPath,
          DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
        );
      } else if (ref.startsWith('document:')) {
        const filename = sanitizeFileName(ref.slice('document:'.length));
        label = `Document: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinRoomData(roomId, 'documents', filename),
          resolveWithinRoomData(roomId, 'reviews', filename),
          resolveWithinRoomData(roomId, 'decisions', filename)
        ]);
      } else if (ref.startsWith('task:')) {
        const filename = sanitizeFileName(ref.slice('task:'.length));
        label = `Task: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinRoomData(roomId, 'tasks', filename)
        ]);
      } else if (ref.startsWith('discussion:')) {
        const filename = sanitizeFileName(ref.slice('discussion:'.length));
        if (!filename.toLowerCase().endsWith('.md')) {
          throw new Error('Only markdown discussion transcripts can be included as context.');
        }
        label = `Previous Discussion: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinRoomData(roomId, 'discussions', filename)
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

export function registerTasksIpc(): void {
  ipcMain.handle('run-task', async (event, { roomId, sourceId, task, taskType, doerName, reviewerNames, maxCycles, contextRefs, associatedCardId, continuedFromTaskId, taskId, temporaryAgents }: { roomId: string; sourceId?: string; task: string; taskType?: string; doerName?: string; reviewerNames?: string[]; maxCycles?: number; contextRefs?: string[]; associatedCardId?: string; continuedFromTaskId?: string; taskId?: string; temporaryAgents?: unknown[] }) => {
    const actualTaskId = taskId || (associatedCardId ? `task-${associatedCardId}` : `task-${Date.now()}`);
    const cycleLimit = Number.isFinite(maxCycles) ? Math.max(1, Math.min(5, Math.floor(maxCycles || 1))) : 2;
    const sendDiscussionEvent = (payload: any) => {
      event.sender.send('discussion-event', payload);
    };
    startControlledRun(actualTaskId);

    try {
      const workspace = requireBoundWorkspace(roomId, sourceId);
      if (taskType === 'coding' && !workspace.sourceRoot) {
        return { success: false, error: 'Attach a Source before running a coding task.' };
      }
      const sourceProvenance = createSourceProvenance(requireBoundRoom(roomId), workspace);
      const engine = new DiscussionEngine(workspace, { providerRegistry: await readProvidersFromDisk() });
      await applyApiKeysToEnvironment();
      const safeTemporaryAgents = normalizeTemporaryAgents(temporaryAgents);
      const agents = [...safeTemporaryAgents, ...await loadAgents(workspace)];
      const doer = doerName
        ? agents.find(agent => agent.name.toLowerCase() === doerName.toLowerCase())
        : agents.find(agent => {
            const text = `${agent.name} ${agent.role}`.toLowerCase();
            return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('writer') || text.includes('researcher') || text.includes('designer') || text.includes('producer');
          });

      if (!doer) {
        return { success: false, error: 'Select a Doer AI member before running the task.' };
      }

      const additionalContext = await buildDiscussionContext(roomId, workspace.sourceRoot, contextRefs);
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

      result.sourceProvenance = sourceProvenance;
      await fs.writeFile(
        resolveWithinRoomData(roomId, 'tasks', result.jsonFilename),
        JSON.stringify(result, null, 2),
        'utf-8'
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

  ipcMain.handle('load-task-board', async (event, { roomId }: { roomId: string }) => {
    try {
      const workspace = requireBoundWorkspace(roomId);
      const board = await loadTaskBoard(workspace);
      return { success: true, cards: board.cards };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
