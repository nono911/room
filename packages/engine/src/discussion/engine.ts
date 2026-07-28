import { loadAgents, type AgentConfig } from '../agents/registry.js';
import { assertLocalCliExecutionAllowed } from '../agents/localCliPolicy.js';
import { LocalCliProvider } from '../providers/localCli.js';
import { Provider } from '../providers/provider.js';
import { resolveApiProvider, type ProviderEntry } from '../providers/index.js';
import { appendRoomEvents, type NewRoomEvent } from '../events/eventLog.js';
import { runDiscussionLoop, type DiscussionRunOptions } from './discussionRunner.js';
import { summarizeDiscussionLoop } from './contextBuilder.js';
import { runCodingTaskLoop, type CodingTaskRunOptions } from './taskRunner.js';
import {
  evaluateDiscussionLoop,
  generateTasksFromDiscussionLoop,
  pickModerator
} from './moderatorRunner.js';
import type { DiscussionMessage, DiscussionLog, CodingTaskResult } from './types.js';
import { type QualityGateResult } from './approvalDetector.js';
import type { MessageReference } from './references.js';
import { type TaskCard } from './taskBoard.js';
import { type ActionExecutionResult } from './actionExecutor.js';
import { executeRecordedRun } from '../runRecords.js';
import {
  createExecutionProvenance,
  isSameExecutionSource,
  type SourceProvenance
} from './types.js';
import {
  resolveExecutionRoot,
  resolveWorkspaceLocation,
  type WorkspaceInput,
  type WorkspaceLocation
} from '../workspace.js';
import { readRoomTextFile } from '../roomFile.js';
import { MAX_RUN_ARTIFACT_BYTES } from './runArtifact.js';
import { withAiRunAdmission } from '../aiRunAdmission.js';
import type { ApprovedMachineSkillSnapshot } from '../skills/machineCatalog.js';
import {
  snapshotRoomSkills,
  type RoomSkillSnapshot
} from './roomSkillSnapshot.js';
import { resolveDiscussionParticipants } from './discussionParticipants.js';
import { resolveCodingTaskParticipants } from './taskParticipants.js';
import { createExecutionParticipantSnapshots } from './executionParticipants.js';
import { isDiscussionRunId, isTaskRunId } from './runId.js';

export interface DiscussionEngineOptions {
  providerRegistry?: ProviderEntry[];
}

export class DiscussionEngine {
  readonly dirPath: string;
  readonly roomRoot: string;
  readonly workspace: WorkspaceLocation;
  private readonly providerRegistry?: ProviderEntry[];

  constructor(workspace: WorkspaceInput, options: DiscussionEngineOptions = {}) {
    this.workspace = resolveWorkspaceLocation(workspace);
    this.dirPath = resolveExecutionRoot(this.workspace);
    this.roomRoot = this.workspace.roomRoot;
    this.providerRegistry = options.providerRegistry;
  }

  getProvider(agent: AgentConfig): Provider {
    if (agent.provider === 'Local CLI') {
      return new LocalCliProvider({
        command: agent.command,
        cliPreset: agent.cliPreset,
        stdinFormat: agent.stdinFormat,
        cwd: this.dirPath,
        roomRoot: this.roomRoot,
        modelName: agent.modelName,
        permissionMode: agent.permissionMode || 'safe'
      });
    }
    return resolveApiProvider(this.providerRegistry, agent.provider, agent.modelName);
  }

  async assertAgentExecutionAllowed(agent: AgentConfig): Promise<void> {
    if (agent.provider === 'Local CLI') {
      assertLocalCliExecutionAllowed(agent);
    }
  }

  async assertCodingTaskWriteAllowed(agent: AgentConfig, taskType: string): Promise<void> {
    if (taskType !== 'coding' || agent.provider !== 'Local CLI') {
      return;
    }

    await this.assertAgentExecutionAllowed(agent);
  }

  async appendEvent(input: NewRoomEvent): Promise<void> {
    await this.appendEvents([input]);
  }

  async appendEvents(inputs: NewRoomEvent[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await appendRoomEvents(this.workspace, inputs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Discussion Engine] Failed to append event(s) ${inputs.map(input => input.type).join(', ')}: ${message}`);
    }
  }

  async appendMessageCreatedEvent(scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage): Promise<void> {
    if (!message.id) return;
    await this.appendEvent({
      type: 'message.created',
      actor: message.agentName,
      source: { type: scopeType, id: scopeId },
      target: { type: 'message', id: message.id },
      data: {
        messageType: message.type || 'agent',
        providerName: message.providerName,
        round: message.round
      }
    });
  }

  async appendReferenceEvents(scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage): Promise<void> {
    if (Array.isArray(message.references) && message.references.length > 0) {
      await this.appendEvents(message.references.map((ref: MessageReference) => {
        const payload: NewRoomEvent = {
          type: 'message.referenced',
          actor: message.agentName,
          source: { type: scopeType, id: scopeId },
          target: { type: 'message', id: ref.messageId || '' },
          data: {
            messageNumber: ref.message,
            reason: ref.reason || ''
          }
        };
        return payload;
      }));
    }
  }

  async appendInterruptEvent(scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage): Promise<void> {
    if (!message.id) return;
    await this.appendEvent({
      type: 'discussion.interrupted',
      actor: 'User',
      source: { type: scopeType, id: scopeId },
      target: { type: 'message', id: message.id },
      data: {
        reason: message.content.replace(/^Interrupt & Pivot:\n\n/, '')
      }
    });
  }

  async runDiscussion(
    discussionId: string,
    title: string,
    topic: string,
    agentNames: string[],
    maxRounds = 2,
    options: DiscussionRunOptions = {}
  ): Promise<DiscussionLog> {
    return withAiRunAdmission(this.workspace, `discussion:${discussionId}`, async () => {
      const skillAgents = options.participants
        ? [...options.participants]
        : resolveDiscussionParticipants(
            await loadAgents(this.workspace),
            options.temporaryAgents || [],
            agentNames
          ).participants;
      const skillSeed = await this.discussionSkillSeed(
        discussionId,
        topic,
        Boolean(options.continueExisting)
      );
      const roomSkillSnapshots = options.roomSkillSnapshots
        ?? await snapshotRoomSkills(this.workspace, {
          references: agentSkillReferences(skillAgents),
          discussionText: skillSeed,
          mentionedFilePaths: mentionedPaths(skillSeed)
        });
      const executionParticipants = createExecutionParticipantSnapshots(
        this.workspace.roomId,
        skillAgents,
        roomSkillSnapshots,
        options.approvedMachineSkills
      );
      return executeRecordedRun(this.workspace, 'discussion', discussionId, provenance =>
      runDiscussionLoop(
        this.workspace,
        discussionId,
        title,
        topic,
        agentNames,
        maxRounds,
        {
          ...options,
          roomSkillSnapshots,
          executionParticipants,
          sourceProvenance: provenance
        },
        this.getProvider.bind(this),
        this.assertAgentExecutionAllowed.bind(this),
        this.appendMessageCreatedEvent.bind(this),
        this.appendReferenceEvents.bind(this),
        this.appendInterruptEvent.bind(this)
      ), discussionId, executionParticipants);
    });
  }

  async runCodingTask(
    taskId: string,
    title: string,
    task: string,
    developerName: string,
    reviewerNames: string[] = [],
    maxCycles = 2,
    options: CodingTaskRunOptions = {}
  ): Promise<CodingTaskResult> {
    const taskType = (options.taskType || 'general').trim().toLowerCase();
    if (taskType === 'coding' && (!this.workspace.sourceId || !this.workspace.sourceRoot)) {
      throw new Error('Attach a Source before running a coding task.');
    }
    if (
      options.continuedFromTaskId !== undefined
      && !isTaskRunId(options.continuedFromTaskId)
    ) throw new Error('Invalid continued task id.');
    if (options.continuedFromTaskId === taskId) {
      throw new Error('A continued task must use a new task id.');
    }
    return withAiRunAdmission(this.workspace, `task:${taskId}`, async () => {
      let skillAgents: AgentConfig[];
      if (options.developer && options.reviewers) {
        skillAgents = [options.developer, ...options.reviewers];
      } else {
        const selected = resolveCodingTaskParticipants(
          [...(options.temporaryAgents || []), ...await loadAgents(this.workspace)],
          developerName,
          reviewerNames
        );
        skillAgents = [selected.developer, ...selected.reviewers];
      }
      const roomSkillSnapshots = options.roomSkillSnapshots
        ?? await snapshotRoomSkills(this.workspace, {
          references: agentSkillReferences(skillAgents),
          discussionText: task,
          mentionedFilePaths: mentionedPaths(task)
        });
      const executionParticipants = createExecutionParticipantSnapshots(
        this.workspace.roomId,
        skillAgents,
        roomSkillSnapshots,
        options.approvedMachineSkills
      );
      return executeRecordedRun(
      this.workspace,
      'task',
      taskId,
      provenance =>
      runCodingTaskLoop(
        this.workspace,
        taskId,
        title,
        task,
        developerName,
        reviewerNames,
        maxCycles,
        {
          ...options,
          roomSkillSnapshots,
          executionParticipants,
          taskType,
          sourceProvenance: provenance
        },
        this.getProvider.bind(this),
        this.assertAgentExecutionAllowed.bind(this),
        this.assertCodingTaskWriteAllowed.bind(this),
        this.appendEvent.bind(this),
        this.appendMessageCreatedEvent.bind(this),
        this.appendReferenceEvents.bind(this),
        this.appendInterruptEvent.bind(this)
      ),
      options.continuedFromTaskId || taskId,
      executionParticipants
      );
    });
  }

  async appendActionEvents(sourceDiscussionId: string, executed: ActionExecutionResult): Promise<void> {
    await this.appendEvents([
      ...executed.createdTaskCards.map(card => ({
        type: 'task.created' as const,
        source: { type: 'discussion' as const, id: sourceDiscussionId },
        target: { type: 'task' as const, id: card.id },
        data: {
          title: card.title,
          kind: card.kind,
          parentId: card.parentId
        }
      })),
      ...executed.createdAdrs.map(adr => ({
        type: 'adr.created' as const,
        source: { type: 'discussion' as const, id: sourceDiscussionId },
        target: { type: 'adr' as const, id: adr.id },
        data: {
          filename: adr.filename
        }
      }))
    ]);
  }

  async evaluateDiscussion(
    discussionId: string,
    moderatorName?: string,
    moderatorOverride?: AgentConfig,
    approvedMachineSkills: readonly ApprovedMachineSkillSnapshot[] = [],
    roomSkillSnapshots?: readonly RoomSkillSnapshot[]
  ): Promise<QualityGateResult> {
    await this.assertDiscussionSource(discussionId);
    return withAiRunAdmission(this.workspace, `moderation:${discussionId}`, async () => {
      const moderator = moderatorOverride
        || pickModerator(await loadAgents(this.workspace), moderatorName);
      if (!moderator) throw new Error('No AI member is available to run the quality gate.');
      const immutableRoomSkills = roomSkillSnapshots
        ?? await snapshotRoomSkills(this.workspace, {
          references: agentSkillReferences([moderator])
        });
      const participants = createExecutionParticipantSnapshots(
        this.workspace.roomId,
        [moderator],
        immutableRoomSkills,
        approvedMachineSkills
      );
      return executeRecordedRun(this.workspace, 'moderation', discussionId, () =>
      evaluateDiscussionLoop(
        this.workspace,
        discussionId,
        moderatorName,
        moderator,
        approvedMachineSkills,
        immutableRoomSkills,
        this.getProvider.bind(this),
        this.assertAgentExecutionAllowed.bind(this),
        this.appendMessageCreatedEvent.bind(this),
        this.appendActionEvents.bind(this)
      ), discussionId, participants);
    });
  }

  async summarizeDiscussion(
    discussionId: string,
    agentNames: string[] = [],
    summaryAgentOverride?: AgentConfig,
    approvedMachineSkills: readonly ApprovedMachineSkillSnapshot[] = [],
    roomSkillSnapshots?: readonly RoomSkillSnapshot[]
  ): Promise<{ filename: string; content: string }> {
    await this.assertDiscussionSource(discussionId);
    return withAiRunAdmission(this.workspace, `summary:${discussionId}`, async () => {
      const summaryAgent = summaryAgentOverride
        || pickSummaryAgent(await loadAgents(this.workspace), agentNames);
      if (!summaryAgent) throw new Error('No AI member is available to summarize this chat.');
      const immutableRoomSkills = roomSkillSnapshots
        ?? await snapshotRoomSkills(this.workspace, {
          references: agentSkillReferences([summaryAgent])
        });
      const participants = createExecutionParticipantSnapshots(
        this.workspace.roomId,
        [summaryAgent],
        immutableRoomSkills,
        approvedMachineSkills
      );
      return executeRecordedRun(this.workspace, 'summary', discussionId, () =>
      summarizeDiscussionLoop(
        this.workspace,
        discussionId,
        agentNames,
        summaryAgent,
        approvedMachineSkills,
        immutableRoomSkills,
        this.getProvider.bind(this),
        this.assertAgentExecutionAllowed.bind(this),
        this.appendEvent.bind(this)
      ), discussionId, participants);
    });
  }

  async generateTasksFromDiscussion(
    discussionId: string,
    moderatorName?: string,
    moderatorOverride?: AgentConfig,
    approvedMachineSkills: readonly ApprovedMachineSkillSnapshot[] = [],
    roomSkillSnapshots?: readonly RoomSkillSnapshot[]
  ): Promise<{ createdTaskCards: TaskCard[]; errors: string[] }> {
    await this.assertDiscussionSource(discussionId);
    return withAiRunAdmission(this.workspace, `task-generation:${discussionId}`, async () => {
      const moderator = moderatorOverride
        || pickModerator(await loadAgents(this.workspace), moderatorName);
      if (!moderator) throw new Error('No AI member is available to generate tasks.');
      const immutableRoomSkills = roomSkillSnapshots
        ?? await snapshotRoomSkills(this.workspace, {
          references: agentSkillReferences([moderator])
        });
      const participants = createExecutionParticipantSnapshots(
        this.workspace.roomId,
        [moderator],
        immutableRoomSkills,
        approvedMachineSkills
      );
      return executeRecordedRun(this.workspace, 'task-generation', discussionId, () =>
      generateTasksFromDiscussionLoop(
        this.workspace,
        discussionId,
        moderatorName,
        moderator,
        approvedMachineSkills,
        immutableRoomSkills,
        this.getProvider.bind(this),
        this.assertAgentExecutionAllowed.bind(this),
        this.appendActionEvents.bind(this)
      ), discussionId, participants);
    });
  }

  private async assertDiscussionSource(discussionId: string): Promise<SourceProvenance> {
    if (!isDiscussionRunId(discussionId)) throw new Error('Invalid discussion id.');
    const log = JSON.parse(await readRoomTextFile(
      this.workspace,
      ['discussions', `${discussionId}.json`],
      MAX_RUN_ARTIFACT_BYTES
    )) as DiscussionLog;
    if (!log.sourceProvenance) throw new Error('Discussion has no execution provenance.');
    const derivedProvenance = createExecutionProvenance(this.workspace);
    if (
      log.sourceProvenance.roomId !== derivedProvenance.roomId
      || !isSameExecutionSource(log.sourceProvenance, derivedProvenance)
    ) {
      throw new Error('A derived run cannot execute under a different Source than its discussion.');
    }
    return log.sourceProvenance;
  }

  private async discussionSkillSeed(
    discussionId: string,
    topic: string,
    continueExisting: boolean
  ): Promise<string> {
    if (!continueExisting) return topic;
    try {
      const log = JSON.parse(await readRoomTextFile(
        this.workspace,
        ['discussions', `${discussionId}.json`],
        MAX_RUN_ARTIFACT_BYTES
      )) as DiscussionLog;
      return [topic, ...log.messages.map(message => message.content)].join('\n');
    } catch {
      return topic;
    }
  }
}

function agentSkillReferences(agents: readonly AgentConfig[]): string[] {
  return Array.from(new Set(agents.flatMap(agent => agent.skills || [])));
}

function pickSummaryAgent(
  agents: readonly AgentConfig[],
  names: readonly string[]
): AgentConfig | undefined {
  return names
    .map(name => agents.find(agent => agent.name.toLowerCase() === name.toLowerCase()))
    .find((agent): agent is AgentConfig => Boolean(agent))
    || agents.find(agent => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return text.includes('reporter') || text.includes('scribe') || text.includes('summary');
    })
    || agents[0];
}

function mentionedPaths(text: string): string[] {
  return Array.from(text.matchAll(/file:\/\/\/([^\s#?)]+)/g), match => match[1]);
}
export type { DiscussionMessage, DiscussionLog, CodingTaskResult } from './types.js';
export { type QualityGateResult };
export { safeDocumentSlug, stripExternalFileLinks } from './utils.js';
export { globToRegex } from './globPattern.js';
