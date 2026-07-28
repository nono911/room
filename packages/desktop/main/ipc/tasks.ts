import { ipcMain } from 'electron';
import {
  DiscussionEngine,
  isTaskRunId,
  loadAgents,
  loadTaskBoard,
  snapshotRoomSkills
} from '@room/engine';
import {
  createSourceProvenance,
  requireBoundRoom,
  requireBoundRoomWorkspace,
  requireBoundSource,
  requireBoundWorkspace
} from './shared.js';
import { normalizeTemporaryAgents } from './temporary-agents.js';
import { buildSelectedContext } from './context-bundle.js';
import { readProvidersFromDisk } from './provider-store.js';
import { finishControlledRun, getRunInterruptMessage, startControlledRun } from './run-control.js';
import { normalizeTaskType } from './task-type.js';
import { createTaskRunId } from './task-run-id.js';
import {
  createRunEventSender,
  toRendererTaskResult,
  type EngineRendererEvent
} from './renderer-safe.js';
import {
  assertJsonBytes,
  assertStringArray,
  assertUtf8Bytes,
  IPC_LIMITS
} from './ipc-limits.js';
import { assertMachineSkillAssignments } from './machine-skill-grants.js';
import { toPublicError } from './public-error.js';
import { resolveParticipantSnapshots } from './participant-snapshot.js';

export function registerTasksIpc(): void {
  ipcMain.handle('run-task', async (event, { roomId, sourceId, task, taskType, doerRef, reviewerRefs, maxCycles, contextRefs, associatedCardId, continuedFromTaskId, temporaryAgents }: { roomId: string; sourceId?: string; task: string; taskType?: string; doerRef?: string; reviewerRefs?: string[]; maxCycles?: number; contextRefs?: string[]; associatedCardId?: string; continuedFromTaskId?: string; temporaryAgents?: unknown[] }) => {
    try {
      assertUtf8Bytes(task, 'Task text', IPC_LIMITS.runTextBytes);
      assertStringArray(reviewerRefs || [], 'Task reviewers', IPC_LIMITS.runParticipants, 128);
      assertStringArray(contextRefs || [], 'Context references', IPC_LIMITS.contextReferences);
      assertJsonBytes(temporaryAgents || [], 'Temporary agents', IPC_LIMITS.teamPayloadBytes);
      assertUtf8Bytes(doerRef || '', 'Doer reference', 128);
      assertUtf8Bytes(associatedCardId || '', 'Task card ID', 512);
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
    if (
      continuedFromTaskId !== undefined
      && !isTaskRunId(continuedFromTaskId)
    ) {
      return { success: false, error: 'Invalid continued task id.' };
    }
    let normalizedTaskType: string;
    try {
      normalizedTaskType = normalizeTaskType(taskType);
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
    const actualTaskId = createTaskRunId();
    const cycleLimit = Number.isFinite(maxCycles) ? Math.max(1, Math.min(5, Math.floor(maxCycles || 1))) : 2;
    const sendDiscussionEvent = createRunEventSender(event.sender);
    try {
      startControlledRun(roomId, actualTaskId, event.sender.id);
    } catch (error: unknown) {
      return {
        success: false,
        error: toPublicError(error)
      };
    }

    try {
      const workspace = requireBoundWorkspace(roomId, sourceId);
      const runSource = workspace.sourceId
        ? requireBoundSource(roomId, workspace.sourceId)
        : undefined;
      if (normalizedTaskType === 'coding' && !workspace.sourceRoot) {
        return { success: false, error: 'Attach a Source before running a coding task.' };
      }
      const sourceProvenance = createSourceProvenance(requireBoundRoom(roomId), workspace);
      const providerRegistry = await readProvidersFromDisk();
      const engine = new DiscussionEngine(workspace, { providerRegistry });
      const safeTemporaryAgents = normalizeTemporaryAgents(temporaryAgents);
      const persistedAgents = (await loadAgents(workspace)).filter(agent => !agent.isVirtual);
      const { participants } = resolveParticipantSnapshots(
        persistedAgents,
        safeTemporaryAgents,
        [doerRef || '', ...(reviewerRefs || [])]
      );
      const [doer, ...reviewers] = participants;
      if (!doer) throw new Error('Select a Doer AI member before running the task.');
      if (reviewers.length === 0) throw new Error('Select at least one Reviewer or Lead member.');
      const persistedParticipants = [doer, ...reviewers].filter(
        agent => persistedAgents.some(candidate => candidate.id === agent.id)
      );
      const approvedMachineSkills = await assertMachineSkillAssignments(
        roomId,
        persistedParticipants,
        providerRegistry
      );
      const roomSkillSnapshots = await snapshotRoomSkills(workspace, {
        references: [doer, ...reviewers].flatMap(agent => agent.skills || []),
        discussionText: task,
        mentionedFilePaths: Array.from(
          task.matchAll(/file:\/\/\/([^\s#?)]+)/g),
          match => match[1]
        )
      });

      const additionalContext = await buildSelectedContext(roomId, runSource, contextRefs);
      const result = await engine.runCodingTask(
        actualTaskId,
        `Task: ${task.slice(0, 40)}...`,
        task,
        doer.name,
        reviewers.map(agent => agent.name),
        cycleLimit,
        {
          onEvent: sendDiscussionEvent,
          additionalContext,
          taskType: normalizedTaskType,
          getInterruptMessage: () => getRunInterruptMessage(roomId, actualTaskId),
          associatedCardId,
          continuedFromTaskId,
          temporaryAgents: safeTemporaryAgents,
          developer: doer,
          reviewers,
          sourceProvenance,
          approvedMachineSkills,
          roomSkillSnapshots
        }
      );

      return { success: true, result: toRendererTaskResult(result) };
    } catch (error: unknown) {
      sendDiscussionEvent({
        type: 'discussion_failed',
        discussionId: actualTaskId,
        error: 'ROOM run failed.'
      });
      return { success: false, error: toPublicError(error, 'ROOM could not complete this run.') };
    } finally {
      finishControlledRun(roomId, actualTaskId);
    }
  });

  ipcMain.handle('load-task-board', async (event, { roomId }: { roomId: string }) => {
    try {
      const workspace = requireBoundRoomWorkspace(roomId);
      const board = await loadTaskBoard(workspace);
      return { success: true, cards: board.cards };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });
}
