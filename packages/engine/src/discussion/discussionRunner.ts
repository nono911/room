import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentConfig } from '../agents/registry.js';
import { Provider } from '../providers/provider.js';
import type { DiscussionMessage, DiscussionLog } from './types.js';
import { loadAgents } from '../agents/registry.js';
import {
  cleanAgentStreamChunk,
  cleanAgentUserContent,
  ensureStableMessageIds,
  nextStableMessageId,
  isOnlyOmissionNotes,
  localCliNoFinalAnswerMessage,
  renderDiscussionMarkdown,
  composeAgentSystemPrompt,
  parseSkipTurn,
  REFERENCE_TRACING_PROTOCOL
} from './utils.js';
import {
  compileContextWithOptionalSummary,
  readFirstExistingFile,
  autoMatchSkills,
  resolveSkillPath,
  isReviewerAgent,
  buildReviewProtocol
} from './contextBuilder.js';
import { parseMessageReferences, type MessageReference } from './references.js';
import { isExplicitlyApproved } from './approvalDetector.js';
import { parseSkillFrontmatter } from '../skills/parser.js';

const DISCUSSION_PROTOCOL = `=== Discussion Protocol ===
Speak in the first person as your assigned AI member role.
Maintain a professional, constructive team tone.
Your replies should be direct, specific, and build upon prior team responses.
Keep each reply under roughly 300 words unless the user explicitly asks for exhaustive detail.
Do not restate points already made in the discussion history; reference them by their visible Message number and add only new reasoning, objections, evidence, or decisions.
If you have nothing material to add this turn, reply with exactly "SKIP: <one short line saying why>" and nothing else.
Ensure all files, lines, and commands you reference are valid within the workspace.`;



export interface DiscussionEvent {
  type: string;
  discussionId: string;
  title?: string;
  message?: DiscussionMessage;
  agentName?: string;
  providerName?: string;
  modelName?: string;
  round?: number;
  chunk?: string;
  error?: string;
  reason?: string;
  log?: DiscussionLog;
  role?: string;
  timestamp?: string;
}

export interface DiscussionRunOptions {
  onEvent?: (event: DiscussionEvent) => void;
  reviewMode?: boolean;
  additionalContext?: string;
  userLabel?: string;
  getInterruptMessage?: () => string | null;
  temporaryAgents?: AgentConfig[];
}

export async function runDiscussionLoop(
  dirPath: string,
  discussionId: string,
  title: string,
  topic: string,
  agentNames: string[],
  maxRounds = 2,
  options: DiscussionRunOptions = {},
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  appendMessageCreatedEvent: (scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage) => Promise<void>,
  appendReferenceEvents: (scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage) => Promise<void>,
  appendInterruptEvent: (scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage) => Promise<void>
): Promise<DiscussionLog> {
  if (!/^discussion-[\w-]+$/.test(discussionId)) {
    throw new Error('Invalid discussion id.');
  }

  const agents = [...(options.temporaryAgents || []), ...await loadAgents(dirPath)];
  const workflowAgents = agentNames
    .map(name => agents.find(a => a.name.toLowerCase() === name.toLowerCase()))
    .filter((a): a is AgentConfig => !!a);

  if (workflowAgents.length === 0) {
    throw new Error(`None of the requested AI members (${agentNames.join(', ') || 'none'}) were found in the workspace.`);
  }

  const discussionsDir = path.join(dirPath, '.room', 'discussions');
  await fs.mkdir(discussionsDir, { recursive: true });
  const logPath = path.join(discussionsDir, `${discussionId}.json`);
  const markdownLogPath = path.join(discussionsDir, `${discussionId}.md`);
  let discussionLog: DiscussionLog;
  try {
    const existingLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
    discussionLog = {
      id: discussionId,
      title: existingLog.title || title,
      topic,
      status: 'active',
      messages: Array.isArray(existingLog.messages) ? existingLog.messages : []
    };
    ensureStableMessageIds(discussionId, discussionLog.messages);
  } catch {
    discussionLog = {
      id: discussionId,
      title: title,
      topic,
      status: 'active',
      messages: []
    };
  }
  options.onEvent?.({
    type: 'discussion_started',
    discussionId,
    title: discussionLog.title
  });

  let projectContext = '';
  const overview = await readFirstExistingFile([
    path.join(dirPath, '.room', 'context', 'overview.md'),
    path.join(dirPath, '.room', 'workspace.md'),
    path.join(dirPath, '.room', 'project.md')
  ]);
  const structure = await readFirstExistingFile([
    path.join(dirPath, '.room', 'context', 'structure.md'),
    path.join(dirPath, '.room', 'architecture', 'current.md')
  ]);
  projectContext = overview;
  if (structure) {
    projectContext += `\n\nWorkspace Structure:\n${structure}`;
  }
  if (options.additionalContext?.trim()) {
    projectContext += `\n\nSelected Context:\n${options.additionalContext.trim()}`;
  }

  const userMessage: DiscussionMessage = {
    id: nextStableMessageId(discussionId, discussionLog.messages),
    type: 'user',
    agentName: options.userLabel || 'You',
    providerName: 'User',
    content: topic,
    timestamp: new Date().toLocaleTimeString()
  };
  discussionLog.messages.push(userMessage);
  await appendMessageCreatedEvent('discussion', discussionId, userMessage);

  const saveDiscussionLog = async () => {
    await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
    await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');
  };
  const applyInterruptIfRequested = async (): Promise<boolean> => {
    const interruptMessage = options.getInterruptMessage?.()?.trim();
    if (!interruptMessage) return false;

    const pivotMessage: DiscussionMessage = {
      id: nextStableMessageId(discussionId, discussionLog.messages),
      type: 'user',
      agentName: options.userLabel || 'You',
      providerName: 'User',
      content: `Interrupt & Pivot:\n\n${interruptMessage}`,
      timestamp: new Date().toLocaleTimeString()
    };
    discussionLog.messages.push(pivotMessage);
    discussionLog.status = 'interrupted';
    await appendMessageCreatedEvent('discussion', discussionId, pivotMessage);
    await appendInterruptEvent('discussion', discussionId, pivotMessage);
    await saveDiscussionLog();
    options.onEvent?.({
      type: 'discussion_interrupted',
      discussionId,
      message: pivotMessage,
      reason: interruptMessage
    });
    return true;
  };

  let approved = false;
  let successfulAgentRuns = 0;
  let failedAgentRuns = 0;
  let interrupted = false;
  const reviewerAgents = options.reviewMode
    ? workflowAgents.filter(agent => isReviewerAgent(agent))
    : [];

  for (let round = 1; round <= maxRounds; round++) {
    const roundReviewerApprovals = new Map<string, boolean>();

    for (const agent of workflowAgents) {
      interrupted = await applyInterruptIfRequested();
      if (interrupted) break;

      console.log(`[Discussion Engine] Running Agent: ${agent.name} (Round ${round})...`);
      await assertAgentExecutionAllowed(agent);
      const provider = getProvider(agent);
      options.onEvent?.({
        type: 'agent_started',
        discussionId,
        agentName: agent.name,
        providerName: agent.provider,
        ...(agent.modelName ? { modelName: agent.modelName } : {}),
        role: agent.role,
        round,
        timestamp: new Date().toLocaleTimeString()
      });

      const mentionedPaths: string[] = [];
      let discussionText = '';
      for (const msg of discussionLog.messages) {
        discussionText += `\n${msg.content}`;
        for (const match of msg.content.matchAll(/file:\/\/\/([^\s#?)]+)/g)) {
          mentionedPaths.push(match[1]);
        }
      }

      const autoMatchedSkills = await autoMatchSkills(dirPath, mentionedPaths, discussionText);
      const allSkillFiles = Array.from(new Set([
        ...(agent.skills || []),
        ...autoMatchedSkills
      ]));

      let skillsContext = '';
      if (allSkillFiles.length > 0) {
        skillsContext = '\n\n=== Active Skills ===\n';
        for (const skillFile of allSkillFiles) {
          try {
            const resolvedSkillPath = await resolveSkillPath(dirPath, skillFile);
            const skillContent = await fs.readFile(resolvedSkillPath, 'utf-8');
            const parsed = parseSkillFrontmatter(skillContent);
            skillsContext += `\n[Skill: ${skillFile}]\n${parsed.content.trim()}\n`;
          } catch (err: any) {
            console.error(`Error loading skill ${skillFile}:`, err.message);
          }
        }
      }

      const compiledContext = await compileContextWithOptionalSummary(
        dirPath,
        'discussion',
        discussionId,
        discussionLog.messages,
        projectContext,
        agents,
        getProvider,
        assertAgentExecutionAllowed
      );
      const contextMessages = compiledContext.includedMessages;
      const priorMessageInstruction = compiledContext.priorMessageInstruction;
      const reviewProtocol = options.reviewMode ? buildReviewProtocol(agent) : '';
      const hasReferableHistory = contextMessages.length > 1;

      let strategyContext = '';
      if (agent.strategy) {
        const sanitizedStrategy = agent.strategy.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const hasAlphanumeric = /[a-z0-9]/.test(sanitizedStrategy);
        if (!hasAlphanumeric) {
          console.warn(`[Discussion Engine] Ignoring invalid strategy name: ${agent.strategy}`);
        } else {
          try {
            const strategyPath = path.resolve(dirPath, '.room', 'strategies', `${sanitizedStrategy}.json`);
            const rawStrat = await fs.readFile(strategyPath, 'utf-8');
            const stratObj = JSON.parse(rawStrat);
            if (stratObj && typeof stratObj.prompt === 'string') {
              strategyContext = `=== Reasoning Strategy: ${stratObj.name || agent.strategy} ===\n${stratObj.prompt}\n`;
            }
          } catch (err: any) {
            console.warn(`[Discussion Engine] Failed to load strategy ${agent.strategy}: ${err.message}`);
          }
        }
      }

      const systemPrompt = composeAgentSystemPrompt(
        agent.systemPrompt,
        agent.provider === 'Local CLI',
        DISCUSSION_PROTOCOL,
        hasReferableHistory ? REFERENCE_TRACING_PROTOCOL : '',
        skillsContext,
        strategyContext,
        reviewProtocol,
        compiledContext.projectContextBlock
      );
      const prompt = `Here is the discussion history available for this response:\n${compiledContext.historyBlock}\n\nPlease provide your response as the ${agent.name} (${agent.role}).${priorMessageInstruction}${options.reviewMode ? '\n\nIf this is a later round, focus on closing remaining OPEN_FINDINGS before introducing new recommendations.' : ''}`;

      let response = '';
      let agentFailed = false;
      let messageReferences: MessageReference[] = [];
      try {
        response = await provider.execute(prompt, systemPrompt, {
          onChunk: (chunk: string) => {
            options.onEvent?.({
              type: 'agent_chunk',
              discussionId,
              agentName: agent.name,
              providerName: agent.provider,
              ...(agent.modelName ? { modelName: agent.modelName } : {}),
              round,
              chunk: cleanAgentStreamChunk(chunk)
            });
          }
        });
        response = cleanAgentUserContent(response, dirPath);
        const skipReason = parseSkipTurn(response);
        if (skipReason) {
          successfulAgentRuns++;
          response = `[${agent.name} skipped this turn: ${skipReason}]`;
          options.onEvent?.({
            type: 'agent_skipped',
            discussionId,
            agentName: agent.name,
            providerName: agent.provider,
            ...(agent.modelName ? { modelName: agent.modelName } : {}),
            round,
            reason: skipReason
          });
        } else {
          const parsedRefs = parseMessageReferences(response, contextMessages);
          messageReferences = parsedRefs.references;
          if (parsedRefs.cleaned) {
            response = parsedRefs.cleaned;
          }
          if (agent.provider === 'Local CLI' && isOnlyOmissionNotes(response)) {
            agentFailed = true;
            failedAgentRuns++;
            response = localCliNoFinalAnswerMessage(agent.name);
          } else {
            successfulAgentRuns++;
          }
        }
      } catch (err: any) {
        agentFailed = true;
        failedAgentRuns++;
        console.error(`Error executing agent ${agent.name}:`, err.message);
        options.onEvent?.({
          type: 'agent_error',
          discussionId,
          agentName: agent.name,
          providerName: agent.provider,
          ...(agent.modelName ? { modelName: agent.modelName } : {}),
          round,
          error: err.message
        });
        response = cleanAgentUserContent(`[System Error from ${agent.name}]: Failed to execute provider ${agent.provider}. Details: ${err.message}`, dirPath);
      }

      const msg: DiscussionMessage = {
        id: nextStableMessageId(discussionId, discussionLog.messages),
        type: 'agent',
        agentName: agent.name,
        providerName: agent.provider,
        ...(agent.modelName ? { modelName: agent.modelName } : {}),
        content: response,
        timestamp: new Date().toLocaleTimeString(),
        contextMessages,
        contextMetrics: {
          ...compiledContext.metrics,
          summaryUsed: compiledContext.summaryUsed,
          omittedMessageCount: compiledContext.omittedMessageCount,
          includedMessageCount: compiledContext.includedMessages.length,
          totalLogMessages: compiledContext.totalLogMessages
        },
        ...(messageReferences.length > 0 ? { references: messageReferences } : {})
      };

      discussionLog.messages.push(msg);
      await appendMessageCreatedEvent('discussion', discussionId, msg);
      await appendReferenceEvents('discussion', discussionId, msg);
      options.onEvent?.({
        type: 'message_completed',
        discussionId,
        message: msg,
        round
      });

      await saveDiscussionLog();

      interrupted = await applyInterruptIfRequested();
      if (interrupted) break;

      if (options.reviewMode && isReviewerAgent(agent)) {
        roundReviewerApprovals.set(agent.name, !agentFailed && isExplicitlyApproved(response));
      }
    }

    if (interrupted) break;

    if (reviewerAgents.length > 0 && reviewerAgents.every(agent => roundReviewerApprovals.get(agent.name) === true)) {
      approved = true;
      console.log('[Discussion Engine] All reviewer agents approved the design. Workflow finished.');
      break;
    }
  }

  if (interrupted) {
    options.onEvent?.({
      type: 'discussion_completed',
      discussionId,
      log: discussionLog
    });
    return discussionLog;
  }

  if (options.reviewMode) {
    discussionLog.status = successfulAgentRuns === 0 && failedAgentRuns > 0
      ? 'blocked'
      : (approved ? 'approved' : 'needs_revision');
  } else {
    discussionLog.status = successfulAgentRuns === 0 && failedAgentRuns > 0 ? 'blocked' : 'completed';
  }
  await saveDiscussionLog();
  options.onEvent?.({
    type: 'discussion_completed',
    discussionId,
    log: discussionLog
  });
  return discussionLog;
}
