import type { AgentConfig } from '../agents/registry.js';
import { assertLocalCliExecutionAllowed } from '../agents/localCliPolicy.js';
import { LocalCliProvider } from '../providers/localCli.js';
import { Provider } from '../providers/provider.js';
import { resolveApiProvider, type ProviderEntry } from '../providers/index.js';
import { appendRoomEvents, type NewRoomEvent } from '../events/eventLog.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { runDiscussionLoop, type DiscussionRunOptions } from './discussionRunner.js';
import { summarizeDiscussionLoop } from './contextBuilder.js';
import { runCodingTaskLoop, type CodingTaskRunOptions } from './taskRunner.js';
import { evaluateDiscussionLoop, generateTasksFromDiscussionLoop } from './moderatorRunner.js';
import type { DiscussionMessage, DiscussionLog, CodingTaskResult } from './types.js';
import { type QualityGateResult } from './approvalDetector.js';
import type { MessageReference } from './references.js';
import { type TaskCard } from './taskBoard.js';
import { type ActionExecutionResult } from './actionExecutor.js';

export interface DiscussionEngineOptions {
  providerRegistry?: ProviderEntry[];
}

export class DiscussionEngine {
  readonly dirPath: string;
  private readonly providerRegistry?: ProviderEntry[];

  constructor(dirPath: string, options: DiscussionEngineOptions = {}) {
    this.dirPath = dirPath;
    this.providerRegistry = options.providerRegistry;
  }

  getProvider(agent: AgentConfig): Provider {
    if (agent.provider === 'Local CLI') {
      return new LocalCliProvider({
        command: agent.command,
        cliPreset: agent.cliPreset,
        stdinFormat: agent.stdinFormat,
        cwd: this.dirPath,
        modelName: agent.modelName,
        permissionMode: agent.permissionMode || 'safe'
      });
    }
    return resolveApiProvider(this.providerRegistry, agent.provider, agent.modelName);
  }

  async assertAgentExecutionAllowed(agent: AgentConfig): Promise<void> {
    if (agent.provider === 'Local CLI') {
      assertLocalCliExecutionAllowed(agent, await this.isDangerousLocalCliAllowed());
    }
  }

  async assertCodingTaskWriteAllowed(agent: AgentConfig, taskType: string): Promise<void> {
    if (taskType !== 'coding' || agent.provider !== 'Local CLI') {
      return;
    }

    if ((agent.permissionMode || 'safe') !== 'dangerous') {
      throw new Error(`Coding tasks require workspace write access for Local CLI Developer "${agent.name}". Edit this AI member, enable dangerous permissions, then enable dangerous workspace CLI permissions in project settings.`);
    }

    await this.assertAgentExecutionAllowed(agent);
  }

  async isDangerousLocalCliAllowed(): Promise<boolean> {
    try {
      const configPath = path.join(this.dirPath, '.room', 'config.json');
      const parsed = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { allowDangerousCli?: unknown };
      return parsed.allowDangerousCli === true;
    } catch {
      return false;
    }
  }

  async appendEvent(input: NewRoomEvent): Promise<void> {
    await this.appendEvents([input]);
  }

  async appendEvents(inputs: NewRoomEvent[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await appendRoomEvents(this.dirPath, inputs);
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
    return runDiscussionLoop(
      this.dirPath,
      discussionId,
      title,
      topic,
      agentNames,
      maxRounds,
      options,
      this.getProvider.bind(this),
      this.assertAgentExecutionAllowed.bind(this),
      this.appendMessageCreatedEvent.bind(this),
      this.appendReferenceEvents.bind(this),
      this.appendInterruptEvent.bind(this)
    );
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
    return runCodingTaskLoop(
      this.dirPath,
      taskId,
      title,
      task,
      developerName,
      reviewerNames,
      maxCycles,
      options,
      this.getProvider.bind(this),
      this.assertAgentExecutionAllowed.bind(this),
      this.assertCodingTaskWriteAllowed.bind(this),
      this.appendEvent.bind(this),
      this.appendMessageCreatedEvent.bind(this),
      this.appendReferenceEvents.bind(this),
      this.appendInterruptEvent.bind(this)
    );
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
    moderatorName?: string
  ): Promise<QualityGateResult> {
    return evaluateDiscussionLoop(
      this.dirPath,
      discussionId,
      moderatorName,
      this.getProvider.bind(this),
      this.assertAgentExecutionAllowed.bind(this),
      this.appendMessageCreatedEvent.bind(this),
      this.appendActionEvents.bind(this)
    );
  }

  async summarizeDiscussion(
    discussionId: string,
    agentNames: string[] = [],
    summaryAgentOverride?: AgentConfig
  ): Promise<{ filename: string; content: string }> {
    return summarizeDiscussionLoop(
      this.dirPath,
      discussionId,
      agentNames,
      summaryAgentOverride,
      this.getProvider.bind(this),
      this.assertAgentExecutionAllowed.bind(this),
      this.appendEvent.bind(this)
    );
  }

  async generateTasksFromDiscussion(
    discussionId: string,
    moderatorName?: string
  ): Promise<{ createdTaskCards: TaskCard[]; errors: string[] }> {
    return generateTasksFromDiscussionLoop(
      this.dirPath,
      discussionId,
      moderatorName,
      this.getProvider.bind(this),
      this.assertAgentExecutionAllowed.bind(this),
      this.appendActionEvents.bind(this)
    );
  }
}
export type { DiscussionMessage, DiscussionLog, CodingTaskResult } from './types.js';
export { type QualityGateResult };
export { safeDocumentSlug, stripExternalFileLinks } from './utils.js';
export { globToRegex } from './contextBuilder.js';
