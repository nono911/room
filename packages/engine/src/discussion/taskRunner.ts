import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentConfig } from '../agents/registry.js';
import { Provider } from '../providers/provider.js';
import type { CodingTaskResult, DiscussionMessage } from './types.js';
import type { NewRoomEvent } from '../events/eventLog.js';
import { loadAgents } from '../agents/registry.js';
import {
  cleanAgentStreamChunk,
  cleanAgentUserContent,
  messageIdFor,
  nextStableMessageId,
  isOnlyOmissionNotes,
  localCliNoFinalAnswerMessage,
  renderCodingTaskMarkdown,
  renderTaskArtifact,
  composeAgentSystemPrompt,
  isDeveloperAgent,
  cleanUpParentTaskFiles,
  REFERENCE_TRACING_PROTOCOL,
  DOER_WORK_INSTRUCTIONS_CODING,
  DOER_WORK_INSTRUCTIONS_GENERAL,
  REVIEWER_RULES_CODING,
  REVIEWER_RULES_GENERAL,
  executeAgentStep
} from './utils.js';
import {
  compileContextWithOptionalSummary,
  readFirstExistingFile,
  isReviewerAgent,
  buildReviewProtocol
} from './contextBuilder.js';
import type { MessageReference } from './references.js';
import { parseCodingApproval, extractTaskReviewSummary } from './approvalDetector.js';
import { updateTaskCardStatus } from './taskBoard.js';
import {
  resolveRoomPath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from '../workspace.js';

export interface CodingTaskEvent {
  type: string;
  discussionId: string;
  message?: DiscussionMessage;
  agentName?: string;
  providerName?: string;
  modelName?: string;
  round?: number;
  chunk?: string;
  error?: string;
  role?: string;
  timestamp?: string;
  log?: { id: string; title: string; topic: string; status: string; messages: DiscussionMessage[] };
  reason?: string | null;
  title?: string;
}

export interface CodingTaskRunOptions {
  onEvent?: (event: CodingTaskEvent) => void;
  additionalContext?: string;
  taskType?: string;
  getInterruptMessage?: () => string | null;
  associatedCardId?: string;
  continuedFromTaskId?: string;
  temporaryAgents?: AgentConfig[];
}

export async function runCodingTaskLoop(
  workspace: WorkspaceInput,
  taskId: string,
  title: string,
  task: string,
  developerName: string,
  reviewerNames: string[] = [],
  maxCycles = 2,
  options: CodingTaskRunOptions = {},
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  assertCodingTaskWriteAllowed: (agent: AgentConfig, taskType: string) => Promise<void>,
  appendEvent: (input: NewRoomEvent) => Promise<void>,
  appendMessageCreatedEvent: (scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage) => Promise<void>,
  appendReferenceEvents: (scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage) => Promise<void>,
  appendInterruptEvent: (scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage) => Promise<void>
): Promise<CodingTaskResult> {
  if (!/^task-[\w-]+$/.test(taskId)) {
    throw new Error('Invalid task id.');
  }

  const { sourceRoot } = resolveWorkspaceLocation(workspace);
  const agents = [...(options.temporaryAgents || []), ...await loadAgents(workspace)];
  const developer = agents.find(agent => agent.name.toLowerCase() === developerName.toLowerCase())
    || agents.find(agent => isDeveloperAgent(agent));
  if (!developer) {
    throw new Error('No Doer AI member is available for this task.');
  }

  const reviewers = reviewerNames
    .map(name => agents.find(agent => agent.name.toLowerCase() === name.toLowerCase()))
    .filter((agent): agent is AgentConfig => !!agent);
  const fallbackReviewer = agents.find(agent => isReviewerAgent(agent));
  if (reviewers.length === 0 && fallbackReviewer) {
    reviewers.push(fallbackReviewer);
  }
  if (reviewers.length === 0) {
    throw new Error('No Reviewer or Lead AI member is available for this task.');
  }

  const taskType = (options.taskType || 'general').trim().toLowerCase();
  await assertCodingTaskWriteAllowed(developer, taskType);

  const tasksDir = resolveRoomPath(workspace, 'tasks');
  const documentsDir = resolveRoomPath(workspace, 'documents');
  await fs.mkdir(tasksDir, { recursive: true });
  await fs.mkdir(documentsDir, { recursive: true });
  const jsonFilename = `${taskId}.json`;
  const markdownFilename = `${taskId}.md`;
  const artifactFilename = `${taskId}-artifact.md`;
  const jsonPath = path.join(tasksDir, jsonFilename);
  const markdownPath = path.join(tasksDir, markdownFilename);
  const artifactPath = path.join(documentsDir, artifactFilename);

  const isCodingTask = taskType === 'coding';
  const doerLabel = isCodingTask ? 'Developer' : 'Doer';
  const reviewerLabel = isCodingTask ? 'Senior Developer or Reviewer' : 'Reviewer or Lead';
  const doerWorkInstructions = isCodingTask
    ? DOER_WORK_INSTRUCTIONS_CODING
    : DOER_WORK_INSTRUCTIONS_GENERAL;

  const reviewerRules = isCodingTask
    ? REVIEWER_RULES_CODING
    : REVIEWER_RULES_GENERAL;

  let projectContext = await readFirstExistingFile([
    resolveRoomPath(workspace, 'context', 'overview.md'),
    resolveRoomPath(workspace, 'workspace.md'),
    resolveRoomPath(workspace, 'project.md')
  ]);
  const structure = await readFirstExistingFile([
    resolveRoomPath(workspace, 'context', 'structure.md'),
    resolveRoomPath(workspace, 'architecture', 'current.md')
  ]);
  if (structure) {
    projectContext += `\n\nWorkspace Structure:\n${structure}`;
  }
  if (options.additionalContext?.trim()) {
    projectContext += `\n\nSelected Context:\n${options.additionalContext.trim()}`;
  }

  const result: CodingTaskResult = {
    id: taskId,
    title,
    task,
    taskType,
    status: 'needs_revision',
    cycles: 0,
    messages: [{
      id: messageIdFor(taskId, 1),
      type: 'user',
      agentName: 'You',
      providerName: 'User',
      content: task,
      timestamp: new Date().toLocaleString()
    }],
    markdownFilename,
    jsonFilename,
    artifactFilename,
    statusSummary: 'Task is queued.',
    associatedCardId: options.associatedCardId,
    continuedFromTaskId: options.continuedFromTaskId
  };

  if (options.associatedCardId) {
    await updateTaskCardStatus(workspace, options.associatedCardId, 'in_progress');
  }

  const saveResult = async () => {
    await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
    await fs.writeFile(markdownPath, renderCodingTaskMarkdown(result), 'utf-8');
  };
  const applyInterruptIfRequested = async (): Promise<boolean> => {
    const interruptMessage = options.getInterruptMessage?.()?.trim();
    if (!interruptMessage) return false;

    const pivotMessage: DiscussionMessage = {
      id: nextStableMessageId(taskId, result.messages),
      type: 'user',
      agentName: 'You',
      providerName: 'User',
      content: `Interrupt & Pivot:\n\n${interruptMessage}`,
      timestamp: new Date().toLocaleString(),
      round: result.cycles
    };
    result.messages.push(pivotMessage);
    result.status = 'interrupted';
    result.statusSummary = 'Interrupted by the user. Use the pivot message as the next direction before continuing this task.';
    await appendMessageCreatedEvent('coding-task', taskId, pivotMessage);
    await appendInterruptEvent('coding-task', taskId, pivotMessage);
    await saveResult();
    options.onEvent?.({
      type: 'discussion_interrupted',
      discussionId: taskId,
      message: pivotMessage,
      reason: interruptMessage
    });
    return true;
  };

  options.onEvent?.({ type: 'discussion_started', discussionId: taskId, title });
  await saveResult();
  await appendMessageCreatedEvent('coding-task', taskId, result.messages[0]);

  let reviewerFeedback = '';
  let interrupted = false;
  const cycleLimit = Math.max(1, Math.min(5, Math.floor(maxCycles || 1)));
  for (let cycle = 1; cycle <= cycleLimit; cycle++) {
    result.cycles = cycle;
    interrupted = await applyInterruptIfRequested();
    if (interrupted) break;

    await assertAgentExecutionAllowed(developer);
    const developerProvider = getProvider(developer);
    options.onEvent?.({
      type: 'agent_started',
      discussionId: taskId,
      agentName: developer.name,
      providerName: developer.provider,
      ...(developer.modelName ? { modelName: developer.modelName } : {}),
      role: developer.role,
      round: cycle,
      timestamp: new Date().toLocaleString()
    });

    const developerContext = await compileContextWithOptionalSummary(
      workspace,
      'coding-task',
      taskId,
      result.messages,
      projectContext,
      agents,
      getProvider,
      assertAgentExecutionAllowed
    );
    const developerPrompt = `You are the ${doerLabel} assigned to this ROOM task.

Task type:
${taskType}

Task:
${task}

Workspace root:
${sourceRoot}

${developerContext.projectContextBlock || '=== Project Context ===\n(No workspace context provided.)'}

Task history available for this pass:
${developerContext.historyBlock}

Reviewer feedback to address:
${reviewerFeedback ? 'Use the latest reviewer message(s) in the task history above.' : '(No reviewer feedback yet.)'}

Instructions:
${doerWorkInstructions}
- Use the same natural language as the user's task unless the user explicitly asks otherwise.`;

    const developerSystemPrompt = composeAgentSystemPrompt(
      developer.systemPrompt,
      developer.provider === 'Local CLI',
      'You are in a ROOM task execution loop. Your responsibility is to produce the requested deliverable, then address reviewer feedback until it is approved.',
      REFERENCE_TRACING_PROTOCOL
    );

    const developerStep = await executeAgentStep(
      developerProvider,
      developer,
      developerPrompt,
      developerSystemPrompt,
      sourceRoot,
      taskId,
      cycle,
      developerContext.includedMessages,
      options
    );
    const developerOutput = developerStep.output;
    const developerReferences = developerStep.references;

    const developerMessage: DiscussionMessage = {
      id: nextStableMessageId(taskId, result.messages),
      type: 'agent',
      agentName: developer.name,
      providerName: developer.provider,
      ...(developer.modelName ? { modelName: developer.modelName } : {}),
      content: developerOutput,
      timestamp: new Date().toLocaleString(),
      round: cycle,
      contextMessages: developerContext.includedMessages,
      contextMetrics: {
        ...developerContext.metrics,
        summaryUsed: developerContext.summaryUsed,
        omittedMessageCount: developerContext.omittedMessageCount,
        includedMessageCount: developerContext.includedMessages.length,
        totalLogMessages: developerContext.totalLogMessages
      },
      ...(developerReferences.length > 0 ? { references: developerReferences } : {})
    };
    result.messages.push(developerMessage);
    await appendMessageCreatedEvent('coding-task', taskId, developerMessage);
    await appendReferenceEvents('coding-task', taskId, developerMessage);
    options.onEvent?.({
      type: 'message_completed',
      discussionId: taskId,
      message: developerMessage,
      round: cycle
    });

    await saveResult();
    await fs.writeFile(artifactPath, renderTaskArtifact(result, developerMessage), 'utf-8');

    interrupted = await applyInterruptIfRequested();
    if (interrupted) break;

    const reviewerOutputs: string[] = [];
    const reviewerMessages: DiscussionMessage[] = [];
    const reviewersFailed: string[] = [];


    for (const reviewer of reviewers) {
      await assertAgentExecutionAllowed(reviewer);
      const reviewerProvider = getProvider(reviewer);
      options.onEvent?.({
        type: 'agent_started',
        discussionId: taskId,
        agentName: reviewer.name,
        providerName: reviewer.provider,
        ...(reviewer.modelName ? { modelName: reviewer.modelName } : {}),
        role: reviewer.role,
        round: cycle,
        timestamp: new Date().toLocaleString()
      });

      const reviewerContext = await compileContextWithOptionalSummary(
        workspace,
        'coding-task',
        taskId,
        result.messages,
        projectContext,
        agents,
        getProvider,
        assertAgentExecutionAllowed
      );
      const reviewerPrompt = `You are the ${reviewerLabel} assigned to review this task.

Task:
${task}

Workspace root:
${sourceRoot}

${reviewerContext.projectContextBlock || '=== Project Context ===\n(No workspace context provided.)'}

Task history available for this pass:
${reviewerContext.historyBlock}

Instructions:
${reviewerRules}
- Use the same natural language as the user's task unless the user explicitly asks otherwise.`;

      const reviewerSystemPrompt = composeAgentSystemPrompt(
        reviewer.systemPrompt,
        reviewer.provider === 'Local CLI',
        'You review deliverables in the ROOM workspace task loop. You must provide clear, actionable findings and explicitly set the APPROVAL_STATUS at the end of your reply.',
        REFERENCE_TRACING_PROTOCOL,
        buildReviewProtocol(reviewer)
      );

      const reviewerStep = await executeAgentStep(
        reviewerProvider,
        reviewer,
        reviewerPrompt,
        reviewerSystemPrompt,
        sourceRoot,
        taskId,
        cycle,
        reviewerContext.includedMessages,
        options
      );
      if (reviewerStep.agentFailed) {
        reviewersFailed.push(reviewer.name);
      }
      const reviewerOutput = reviewerStep.output;
      const reviewerReferences = reviewerStep.references;

      reviewerOutputs.push(reviewerOutput);


      const reviewerMessage: DiscussionMessage = {
        id: nextStableMessageId(taskId, result.messages),
        type: 'agent',
        agentName: reviewer.name,
        providerName: reviewer.provider,
        ...(reviewer.modelName ? { modelName: reviewer.modelName } : {}),
        content: reviewerOutput,
        timestamp: new Date().toLocaleString(),
        round: cycle,
        contextMessages: reviewerContext.includedMessages,
        contextMetrics: {
          ...reviewerContext.metrics,
          summaryUsed: reviewerContext.summaryUsed,
          omittedMessageCount: reviewerContext.omittedMessageCount,
          includedMessageCount: reviewerContext.includedMessages.length,
          totalLogMessages: reviewerContext.totalLogMessages
        },
        ...(reviewerReferences.length > 0 ? { references: reviewerReferences } : {})
      };
      reviewerMessages.push(reviewerMessage);
    }

    for (let i = 0; i < reviewerMessages.length; i++) {
      const msg = reviewerMessages[i];
      result.messages.push(msg);
      await appendMessageCreatedEvent('coding-task', taskId, msg);
      await appendReferenceEvents('coding-task', taskId, msg);
      options.onEvent?.({
        type: 'message_completed',
        discussionId: taskId,
        message: msg,
        round: cycle
      });
    }

    await saveResult();

    const allReviewersPassed = reviewersFailed.length === 0;
    if (allReviewersPassed && parseCodingApproval(reviewerOutputs)) {
      result.status = 'approved';
      result.approvedBy = reviewers.map(reviewer => reviewer.name);
      result.statusSummary = `Approved after ${cycle} cycle(s).\n${extractTaskReviewSummary(reviewerOutputs)}`;
      await saveResult();
      if (result.continuedFromTaskId) {
        await cleanUpParentTaskFiles(workspace, result.continuedFromTaskId);
      }
      break;
    }

    reviewerFeedback = reviewerOutputs.join('\n\n');

    interrupted = await applyInterruptIfRequested();
    if (interrupted) break;

    if (cycle === cycleLimit) {
      result.statusSummary = allReviewersPassed
        ? `Task run limit reached without approval after ${cycle} cycle(s).\n${extractTaskReviewSummary(reviewerOutputs)}`
        : `Review execution failed during task cycles. Gaps found: ${reviewersFailed.join(', ')}.`;
    }
  }

  if (interrupted) {
    return result;
  }

  const finalDoerMessage = [...result.messages].reverse().find((msg: DiscussionMessage) => msg.type === 'agent' && isDeveloperAgent(agents.find((a: AgentConfig) => a.name === msg.agentName) || developer));
  await appendEvent({
    type: 'artifact.created',
    source: { type: 'coding-task', id: taskId },
    target: { type: 'artifact', id: artifactFilename },
    data: {
      path: path.join('documents', artifactFilename),
      sourceMessageId: finalDoerMessage?.id
    }
  });

  if (result.associatedCardId && result.status === 'approved') {
    await updateTaskCardStatus(workspace, result.associatedCardId, 'done');
  }

  await saveResult();

  options.onEvent?.({
    type: 'discussion_completed',
    discussionId: taskId,
    log: {
      id: taskId,
      title,
      topic: task,
      status: result.status,
      messages: result.messages
    }
  });
  return result;
}
