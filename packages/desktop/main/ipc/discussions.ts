import { ipcMain } from 'electron';
import {
  createDiscussionRunId,
  DiscussionEngine,
  isDiscussionRunId,
  loadAgents,
  MAX_RUN_ARTIFACT_BYTES,
  readRoomTextFile,
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
import {
  finishControlledRun,
  getRunInterruptMessage,
  startControlledRun
} from './run-control.js';
import {
  toRendererDiscussionLog,
  createRunEventSender,
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
import {
  pickRoleParticipant,
  resolveOptionalParticipantSnapshot,
  resolveParticipantSnapshots
} from './participant-snapshot.js';

export function registerDiscussionsIpc(): void {
  ipcMain.handle('run-discussion', async (event, { roomId, sourceId, topic, participantRefs, maxRounds, reviewMode, contextRefs, discussionId: requestedDiscussionId, qualityGate, moderatorRef, autoSummary, summaryAgentRef, temporaryAgents }: { roomId: string; sourceId?: string; topic: string; participantRefs?: string[]; maxRounds?: number; reviewMode?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; moderatorRef?: string; autoSummary?: boolean; summaryAgentRef?: string; temporaryAgents?: unknown[] }) => {
    try {
      assertUtf8Bytes(topic, 'Discussion topic', IPC_LIMITS.runTextBytes);
      assertStringArray(participantRefs || [], 'Discussion participants', IPC_LIMITS.runParticipants, 128);
      assertStringArray(contextRefs || [], 'Context references', IPC_LIMITS.contextReferences);
      assertJsonBytes(temporaryAgents || [], 'Temporary agents', IPC_LIMITS.teamPayloadBytes);
      assertUtf8Bytes(moderatorRef || '', 'Moderator reference', 128);
      assertUtf8Bytes(summaryAgentRef || '', 'Summary agent reference', 128);
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
    if (requestedDiscussionId !== undefined && !isDiscussionRunId(requestedDiscussionId)) {
      return { success: false, error: 'Invalid discussion id.' };
    }
    const continueExisting = requestedDiscussionId !== undefined;
    const discussionId = requestedDiscussionId || createDiscussionRunId();
    const roundLimit = Number.isFinite(maxRounds) ? Math.max(1, Math.min(10, Math.floor(maxRounds || 1))) : 2;
    const sendDiscussionEvent = createRunEventSender(event.sender);
    try {
      startControlledRun(roomId, discussionId, event.sender.id);
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
      const sourceProvenance = createSourceProvenance(requireBoundRoom(roomId), workspace);
      const providerRegistry = await readProvidersFromDisk();
      const engine = new DiscussionEngine(workspace, { providerRegistry });
      const additionalContext = await buildSelectedContext(roomId, runSource, contextRefs);
      const safeTemporaryAgents = normalizeTemporaryAgents(temporaryAgents);
      const persistedAgents = (await loadAgents(workspace)).filter(agent => !agent.isVirtual);
      const {
        participants,
        persistedParticipants: selectedPersistedAgents
      } = resolveParticipantSnapshots(
        persistedAgents,
        safeTemporaryAgents,
        participantRefs || []
      );
      if (participants.length === 0) {
        throw new Error('Select at least one AI member for this run.');
      }
      const moderator = qualityGate
        ? resolveOptionalParticipantSnapshot(
            persistedAgents,
            safeTemporaryAgents,
            moderatorRef
          ) || pickRoleParticipant(participants, ['moderator', 'lead', 'reviewer'])
        : undefined;
      const summaryAgent = autoSummary
        ? resolveOptionalParticipantSnapshot(
            persistedAgents,
            safeTemporaryAgents,
            summaryAgentRef
          ) || pickRoleParticipant(participants, ['reporter', 'scribe', 'summary'])
        : undefined;
      const persistedDerivedAgents = [moderator, summaryAgent].filter(
        (agent): agent is typeof persistedAgents[number] => (
          Boolean(agent?.id)
          && persistedAgents.some(candidate => candidate.id === agent?.id)
        )
      );
      const approvedMachineSkills = await assertMachineSkillAssignments(
        roomId,
        dedupeAgentsById([...selectedPersistedAgents, ...persistedDerivedAgents]),
        providerRegistry
      );
      const skillAgents = [
        ...participants,
        ...(moderator ? [moderator] : []),
        ...(summaryAgent ? [summaryAgent] : [])
      ];
      const skillSeed = await discussionSkillSeed(
        workspace,
        discussionId,
        topic,
        continueExisting
      );
      const roomSkillSnapshots = await snapshotRoomSkills(workspace, {
        references: skillAgents.flatMap(agent => agent.skills || []),
        discussionText: skillSeed,
        mentionedFilePaths: mentionedPaths(skillSeed)
      });
      let log = await engine.runDiscussion(
        discussionId,
        `Discussion: ${topic.slice(0, 30)}...`,
        topic,
        participants.map(agent => agent.name),
        roundLimit,
        {
          onEvent: sendDiscussionEvent,
          reviewMode: !!reviewMode,
          additionalContext,
          temporaryAgents: safeTemporaryAgents,
          participants,
          sourceProvenance,
          approvedMachineSkills,
          roomSkillSnapshots,
          continueExisting,
          getInterruptMessage: () => getRunInterruptMessage(roomId, discussionId)
        }
      );

      const moderatorActions: Array<{ type: 'task' | 'adr'; id?: string; title?: string; filename?: string }> = [];

      if (qualityGate && log.status !== 'interrupted') {
        const verdict = await engine.evaluateDiscussion(
          discussionId,
          moderator?.name,
          moderator,
          approvedMachineSkills,
          roomSkillSnapshots
        );
        if (verdict.executed) {
          moderatorActions.push(
            ...verdict.executed.createdTaskCards.map(card => ({ type: 'task' as const, id: card.id, title: card.title })),
            ...verdict.executed.createdAdrs.map(adr => ({ type: 'adr' as const, id: adr.id, filename: adr.filename }))
          );
        }

        try {
          log = JSON.parse(await readRoomTextFile(
            workspace,
            ['discussions', `${discussionId}.json`],
            MAX_RUN_ARTIFACT_BYTES
          ));
        } catch {}
      }

      let summary: { filename: string; content: string } | undefined;
      if (autoSummary && log.status !== 'interrupted') {
        summary = await engine.summarizeDiscussion(
          discussionId,
          summaryAgent ? [summaryAgent.name] : [],
          summaryAgent,
          approvedMachineSkills,
          roomSkillSnapshots
        );
      }

      return { success: true, log: toRendererDiscussionLog(log), summary, moderatorActions };
    } catch (error: unknown) {
      sendDiscussionEvent({
        type: 'discussion_failed',
        discussionId,
        error: 'ROOM run failed.'
      });
      return { success: false, error: toPublicError(error, 'ROOM could not complete this run.') };
    } finally {
      finishControlledRun(roomId, discussionId);
    }
  });

  ipcMain.handle('summarize-discussion', async (_event, { roomId, discussionId, participantRefs, summaryAgentRef, temporaryAgents }: { roomId: string; discussionId: string; participantRefs?: string[]; summaryAgentRef?: string; temporaryAgents?: unknown[] }) => {
    try {
      assertStringArray(participantRefs || [], 'Summary participants', IPC_LIMITS.runParticipants, 128);
      assertUtf8Bytes(summaryAgentRef || '', 'Summary agent reference', 128);
      assertJsonBytes(temporaryAgents || [], 'Temporary agents', IPC_LIMITS.teamPayloadBytes);
      if (!isDiscussionRunId(discussionId)) {
        return { success: false, error: 'Invalid discussion id.' };
      }
      const workspace = await resolveDiscussionWorkspace(roomId, discussionId);

      const persistedAgents = (await loadAgents(workspace)).filter(agent => !agent.isVirtual);
      const safeTemporaryAgents = normalizeTemporaryAgents(temporaryAgents);
      const selected = resolveParticipantSnapshots(
        persistedAgents,
        safeTemporaryAgents,
        participantRefs || []
      ).participants;
      const summaryAgent = resolveOptionalParticipantSnapshot(
        persistedAgents,
        safeTemporaryAgents,
        summaryAgentRef
      ) || pickRoleParticipant(selected.length > 0 ? selected : persistedAgents, [
        'reporter',
        'scribe',
        'summary'
      ]);
      if (!summaryAgent) throw new Error('No AI member is available to summarize this chat.');
      const providerRegistry = await readProvidersFromDisk();
      const approvedMachineSkills = await assertMachineSkillAssignments(
        roomId,
        [summaryAgent],
        providerRegistry
      );
      const roomSkillSnapshots = await snapshotRoomSkills(workspace, {
        references: summaryAgent.skills || []
      });
      const engine = new DiscussionEngine(workspace, { providerRegistry });
      const summary = await engine.summarizeDiscussion(
        discussionId,
        [summaryAgent.name],
        summaryAgent,
        approvedMachineSkills,
        roomSkillSnapshots
      );
      return { success: true, ...summary };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('generate-tasks-from-discussion', async (_event, { roomId, discussionId, moderatorRef }: { roomId: string; discussionId: string; moderatorRef?: string }) => {
    try {
      assertUtf8Bytes(moderatorRef || '', 'Moderator reference', 128);
      if (!isDiscussionRunId(discussionId)) {
        return { success: false, error: 'Invalid discussion id.' };
      }
      const workspace = await resolveDiscussionWorkspace(roomId, discussionId);

      const persistedAgents = (await loadAgents(workspace)).filter(agent => !agent.isVirtual);
      const moderator = resolveOptionalParticipantSnapshot(
        persistedAgents,
        [],
        moderatorRef
      ) || pickRoleParticipant(persistedAgents, ['moderator', 'lead', 'reviewer']);
      if (!moderator) throw new Error('No AI member is available to generate tasks.');
      const providerRegistry = await readProvidersFromDisk();
      const approvedMachineSkills = await assertMachineSkillAssignments(
        roomId,
        [moderator],
        providerRegistry
      );
      const roomSkillSnapshots = await snapshotRoomSkills(workspace, {
        references: moderator.skills || []
      });
      const engine = new DiscussionEngine(workspace, { providerRegistry });
      const result = await engine.generateTasksFromDiscussion(
        discussionId,
        moderator.name,
        moderator,
        approvedMachineSkills,
        roomSkillSnapshots
      );
      return { success: true, ...result };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });
}

function dedupeAgentsById<T extends { id?: string }>(agents: T[]): T[] {
  const seen = new Set<string>();
  return agents.filter(agent => {
    if (!agent.id || seen.has(agent.id)) return false;
    seen.add(agent.id);
    return true;
  });
}

async function resolveDiscussionWorkspace(
  roomId: string,
  discussionId: string
) {
  const roomWorkspace = requireBoundRoomWorkspace(roomId);
  const discussion = JSON.parse(await readRoomTextFile(
    roomWorkspace,
    ['discussions', `${discussionId}.json`],
    MAX_RUN_ARTIFACT_BYTES
  )) as { sourceProvenance?: { mode?: unknown; sourceId?: unknown } };
  if (!discussion.sourceProvenance) {
    throw new Error('Discussion has no execution provenance.');
  }
  if (discussion.sourceProvenance.mode === 'room-only') return roomWorkspace;
  if (
    discussion.sourceProvenance.mode !== 'source'
    || typeof discussion.sourceProvenance.sourceId !== 'string'
  ) throw new Error('Discussion Source provenance is invalid.');
  return requireBoundWorkspace(roomId, discussion.sourceProvenance.sourceId);
}

async function discussionSkillSeed(
  workspace: ReturnType<typeof requireBoundRoomWorkspace>,
  discussionId: string,
  topic: string,
  continueExisting: boolean
): Promise<string> {
  if (!continueExisting) return topic;
  try {
    const log = JSON.parse(await readRoomTextFile(
      workspace,
      ['discussions', `${discussionId}.json`],
      MAX_RUN_ARTIFACT_BYTES
    )) as { messages?: Array<{ content?: unknown }> };
    return [
      topic,
      ...(log.messages || []).flatMap(message => (
        typeof message.content === 'string' ? [message.content] : []
      ))
    ].join('\n');
  } catch {
    return topic;
  }
}

function mentionedPaths(text: string): string[] {
  return Array.from(text.matchAll(/file:\/\/\/([^\s#?)]+)/g), match => match[1]);
}
