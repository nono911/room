import type { AgentConfig } from '../agents/registry.js';
import { Provider } from '../providers/provider.js';
import {
  createExecutionProvenance,
  type CodingTaskResult,
  type DiscussionMessage
} from './types.js';
import type { CodingTaskEvent, CodingTaskRunOptions } from './taskRunnerTypes.js';
import type { NewRoomEvent } from '../events/eventLog.js';
import { loadAgents } from '../agents/registry.js';
import {
  cleanAgentStreamChunk,
  cleanAgentUserContent,
  messageIdFor,
  nextStableMessageId,
  isOnlyOmissionNotes,
  localCliNoFinalAnswerMessage,
  renderTaskArtifact,
  composeAgentSystemPrompt,
  isDeveloperAgent,
  REFERENCE_TRACING_PROTOCOL,
  DOER_WORK_INSTRUCTIONS_CODING,
  DOER_WORK_INSTRUCTIONS_GENERAL,
  REVIEWER_RULES_CODING,
  REVIEWER_RULES_GENERAL,
  executeAgentStep
} from './utils.js';
import {
  compileContextWithOptionalSummary,
  buildSkillsContext,
  buildReviewProtocol
} from './contextBuilder.js';
import { loadRunContextFiles } from './runContext.js';
import type { MessageReference } from './references.js';
import { parseCodingApproval, extractTaskReviewSummary } from './approvalDetector.js';
import { updateTaskCardStatusBestEffort } from './taskBoard.js';
import { writeRoomTextFile } from '../roomFile.js';
import {
  resolveExecutionRoot,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from '../workspace.js';
import { validateTaskLineage } from './taskLineage.js';
import { resolveCodingTaskParticipants } from './taskParticipants.js';
import { saveCodingTaskResult } from './taskPersistence.js';
import { autoMatchedRoomSkillReferences } from './roomSkillSnapshot.js';
import { isTaskRunId } from './runId.js';

export type { CodingTaskEvent, CodingTaskRunOptions } from './taskRunnerTypes.js';
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
  if (!isTaskRunId(taskId)) {
    throw new Error('Invalid task id.');
  }
  if (
    options.continuedFromTaskId !== undefined
    && !isTaskRunId(options.continuedFromTaskId)
  ) {
    throw new Error('Invalid continued task id.');
  }
  if (options.continuedFromTaskId === taskId) {
    throw new Error('A continued task must use a new task id.');
  }

  const sourceRoot = resolveExecutionRoot(workspace);
  const selectedParticipants = options.developer && options.reviewers
    ? { developer: options.developer, reviewers: [...options.reviewers] }
    : resolveCodingTaskParticipants(
        [...(options.temporaryAgents || []), ...await loadAgents(workspace)],
        developerName,
        reviewerNames
      );
  const { developer, reviewers } = selectedParticipants;
  const agents = [developer, ...reviewers];
  const autoMatchedSkills = autoMatchedRoomSkillReferences(options.roomSkillSnapshots || []);
  const activeSkills = (agent: AgentConfig) => Array.from(new Set([...(agent.skills || []), ...autoMatchedSkills]));
  const taskType = (options.taskType || 'general').trim().toLowerCase();
  await assertCodingTaskWriteAllowed(developer, taskType);

  const jsonFilename = `${taskId}.json`;
  const markdownFilename = `${taskId}.md`;
  const artifactFilename = `${taskId}-artifact.md`;
  const executionProvenance = options.sourceProvenance
    || createExecutionProvenance(resolveWorkspaceLocation(workspace));
  const executionContextLabel = executionProvenance.mode === 'source'
    ? `Source "${executionProvenance.sourceName}" (${executionProvenance.sourceId})`
    : `Room ${executionProvenance.roomId} (no Source attached)`;
  const existingResult = await validateTaskLineage(
    workspace,
    taskId,
    options.continuedFromTaskId,
    executionProvenance
  );

  const isCodingTask = taskType === 'coding';
  const doerLabel = isCodingTask ? 'Developer' : 'Doer';
  const reviewerLabel = isCodingTask ? 'Senior Developer or Reviewer' : 'Reviewer or Lead';
  const doerWorkInstructions = isCodingTask
    ? DOER_WORK_INSTRUCTIONS_CODING
    : DOER_WORK_INSTRUCTIONS_GENERAL;

  const reviewerRules = isCodingTask
    ? REVIEWER_RULES_CODING
    : REVIEWER_RULES_GENERAL;
  const { overview, structure } = await loadRunContextFiles(workspace);
  let projectContext = overview;
  if (structure) {
    projectContext += `\n\nRoom Structure:\n${structure}`;
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
    continuedFromTaskId: options.continuedFromTaskId,
    participants: [...(options.executionParticipants || [])],
    sourceProvenance: existingResult?.sourceProvenance || executionProvenance
  };

  if (options.associatedCardId) {
    await updateTaskCardStatusBestEffort(workspace, options.associatedCardId, 'in_progress', 'in_progress');
  }

  const saveResult = async () => {
    await saveCodingTaskResult(workspace, result);
  };
  await saveResult();
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
      assertAgentExecutionAllowed,
      undefined,
      options.approvedMachineSkills,
      options.roomSkillSnapshots
    );
    const developerPrompt = `You are the ${doerLabel} assigned to this ROOM task.

Task type:
${taskType}

Task:
${task}

Execution context:
${executionContextLabel}

${developerContext.projectContextBlock || '=== Room Context ===\n(No Room context provided.)'}

Task history available for this pass:
${developerContext.historyBlock}

Reviewer feedback to address:
${reviewerFeedback ? 'Use the latest reviewer message(s) in the task history above.' : '(No reviewer feedback yet.)'}

Instructions:
${doerWorkInstructions}
- Use the same natural language as the user's task unless the user explicitly asks otherwise.`;

    const developerSkillsContext = await buildSkillsContext(
      workspace,
      activeSkills(developer),
      1500,
      undefined,
      options.approvedMachineSkills,
      developer,
      options.roomSkillSnapshots
    );
    const developerSystemPrompt = composeAgentSystemPrompt(
      developer.systemPrompt,
      developer.provider === 'Local CLI',
      'You are in a ROOM task execution loop. Your responsibility is to produce the requested deliverable, then address reviewer feedback until it is approved.',
      REFERENCE_TRACING_PROTOCOL,
      developerSkillsContext
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
    await writeRoomTextFile(
      workspace,
      ['documents', artifactFilename],
      renderTaskArtifact(result, developerMessage)
    );

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
        assertAgentExecutionAllowed,
        undefined,
        options.approvedMachineSkills,
        options.roomSkillSnapshots
      );
      const reviewerPrompt = `You are the ${reviewerLabel} assigned to review this task.

Task:
${task}

Execution context:
${executionContextLabel}

${reviewerContext.projectContextBlock || '=== Room Context ===\n(No Room context provided.)'}

Task history available for this pass:
${reviewerContext.historyBlock}

Instructions:
${reviewerRules}
- Use the same natural language as the user's task unless the user explicitly asks otherwise.`;

      const reviewerSkillsContext = await buildSkillsContext(
        workspace,
        activeSkills(reviewer),
        1500,
        undefined,
        options.approvedMachineSkills,
        reviewer,
        options.roomSkillSnapshots
      );
      const reviewerSystemPrompt = composeAgentSystemPrompt(
        reviewer.systemPrompt,
        reviewer.provider === 'Local CLI',
        'You review deliverables in the Room task loop. You must provide clear, actionable findings and explicitly set the APPROVAL_STATUS at the end of your reply.',
        REFERENCE_TRACING_PROTOCOL,
        buildReviewProtocol(reviewer),
        reviewerSkillsContext
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
      path: `documents/${artifactFilename}`,
      sourceMessageId: finalDoerMessage?.id
    }
  });

  if (result.associatedCardId && result.status === 'approved') {
    await updateTaskCardStatusBestEffort(workspace, result.associatedCardId, 'done', 'done');
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
