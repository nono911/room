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
  LOCAL_CLI_READ_TOOLS_POLICY,
  REFERENCE_TRACING_PROTOCOL
} from './utils.js';
import {
  compileContextWithOptionalSummary,
  readFirstExistingFile,
  composeProjectContext,
  loadWorkspaceMemoryContext,
  buildSkillsContext,
  autoMatchSkills,
  isReviewerAgent,
  buildReviewProtocol
} from './contextBuilder.js';
import { parseMessageReferences, type MessageReference } from './references.js';
import { isExplicitlyApproved } from './approvalDetector.js';
import {
  resolveRoomPath,
  resolveExecutionRoot,
  type WorkspaceInput
} from '../workspace.js';

const DISCUSSION_PROTOCOL = `=== Discussion Protocol ===
Speak in the first person as your assigned AI member role.
Maintain a professional, constructive team tone.
Your replies should be direct, specific, and build upon prior team responses.
Keep each reply under roughly 300 words unless the user explicitly asks for exhaustive detail.
Do not restate points already made in the discussion history; reference them by their stable mNNNN id when available, or visible Message number as a fallback, and add only new reasoning, objections, evidence, or decisions.
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
  allowReadOnlyTools?: boolean;
}

export async function runDiscussionLoop(
  workspace: WorkspaceInput,
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

  const sourceRoot = resolveExecutionRoot(workspace);
  const agents = [...(options.temporaryAgents || []), ...await loadAgents(workspace)];
  const workflowAgents = agentNames
    .map(name => agents.find(a => a.name.toLowerCase() === name.toLowerCase()))
    .filter((a): a is AgentConfig => !!a);

  if (workflowAgents.length === 0) {
    throw new Error(`None of the requested AI members (${agentNames.join(', ') || 'none'}) were found in the Room.`);
  }

  const discussionsDir = resolveRoomPath(workspace, 'discussions');
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

  const overview = await readFirstExistingFile([
    resolveRoomPath(workspace, 'context', 'overview.md'),
    resolveRoomPath(workspace, 'workspace.md'),
    resolveRoomPath(workspace, 'project.md')
  ]);
  const structure = await readFirstExistingFile([
    resolveRoomPath(workspace, 'context', 'structure.md'),
    resolveRoomPath(workspace, 'architecture', 'current.md')
  ]);
  const workspaceMemory = await loadWorkspaceMemoryContext(workspace, 2500, discussionId);
  const projectContext = composeProjectContext({
    overview,
    structure,
    additionalContext: options.additionalContext,
    workspaceMemory
  });

  const userMessage: DiscussionMessage = {
    id: nextStableMessageId(discussionId, discussionLog.messages),
    type: 'user',
    agentName: options.userLabel || 'You',
    providerName: 'User',
    content: topic,
    timestamp: new Date().toLocaleString()
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
      timestamp: new Date().toLocaleString()
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
  const reviewerApprovalState = new Map<string, boolean>();

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
        timestamp: new Date().toLocaleString()
      });

      const mentionedPaths: string[] = [];
      let discussionText = '';
      for (const msg of discussionLog.messages) {
        discussionText += `\n${msg.content}`;
        for (const match of msg.content.matchAll(/file:\/\/\/([^\s#?)]+)/g)) {
          mentionedPaths.push(match[1]);
        }
      }

      const autoMatchedSkills = await autoMatchSkills(workspace, mentionedPaths, discussionText);
      const allSkillFiles = Array.from(new Set([
        ...(agent.skills || []),
        ...autoMatchedSkills
      ]));

      const skillsContext = await buildSkillsContext(workspace, allSkillFiles);

      const compiledContext = await compileContextWithOptionalSummary(
        workspace,
        'discussion',
        discussionId,
        discussionLog.messages,
        projectContext,
        workflowAgents,
        getProvider,
        assertAgentExecutionAllowed,
        summaryEvent => options.onEvent?.({
          type: summaryEvent.type,
          discussionId,
          round,
          ...(summaryEvent.error ? { error: summaryEvent.error } : {})
        })
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
            const strategyPath = resolveRoomPath(workspace, 'strategies', `${sanitizedStrategy}.json`);
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

      const readOnlyToolsEnabled = !!options.allowReadOnlyTools
        && agent.provider === 'Local CLI'
        && agent.permissionMode !== 'dangerous';
      const systemPrompt = composeAgentSystemPrompt(
        agent.systemPrompt,
        agent.provider === 'Local CLI' && !readOnlyToolsEnabled,
        readOnlyToolsEnabled ? LOCAL_CLI_READ_TOOLS_POLICY : '',
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
      let agentSkipped = false;
      let messageReferences: MessageReference[] = [];
      try {
        response = await provider.execute(prompt, systemPrompt, {
          toolAccess: readOnlyToolsEnabled ? 'read-only' : 'none',
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
        response = cleanAgentUserContent(response, sourceRoot);
        const skipReason = parseSkipTurn(response);
        if (skipReason) {
          agentSkipped = true;
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
        response = cleanAgentUserContent(`[System Error from ${agent.name}]: Failed to execute provider ${agent.provider}. Details: ${err.message}`, sourceRoot);
      }

      const msg: DiscussionMessage = {
        id: nextStableMessageId(discussionId, discussionLog.messages),
        type: 'agent',
        agentName: agent.name,
        providerName: agent.provider,
        ...(agent.modelName ? { modelName: agent.modelName } : {}),
        content: response,
        timestamp: new Date().toLocaleString(),
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
        const explicitlyApproved = !agentFailed && isExplicitlyApproved(response);
        const approvedByPriorSkip = !agentFailed && agentSkipped && reviewerApprovalState.get(agent.name) === true;
        const reviewerApproved = explicitlyApproved || approvedByPriorSkip;
        reviewerApprovalState.set(agent.name, reviewerApproved);
        roundReviewerApprovals.set(agent.name, reviewerApproved);
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
