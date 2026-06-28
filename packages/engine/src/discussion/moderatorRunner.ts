import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentConfig } from '../agents/registry.js';
import { Provider } from '../providers/provider.js';
import type { DiscussionLog, DiscussionMessage } from './types.js';
import { loadAgents } from '../agents/registry.js';
import {
  ensureStableMessageIds,
  renderDiscussionMarkdown,
  stripExternalFileLinks,
  LANGUAGE_POLICY,
  WORKSPACE_BOUNDARY_POLICY,
  nextStableMessageId
} from './utils.js';
import { parseModeratorActions, stripActionBlocks } from './actions.js';
import { executeModeratorActions, type ActionExecutionResult } from './actionExecutor.js';
import { parseQualityGateResult, type QualityGateResult } from './approvalDetector.js';
import { type TaskCard } from './taskBoard.js';

export function pickModerator(agents: AgentConfig[], moderatorName?: string): AgentConfig | undefined {
  if (moderatorName) {
    const matched = agents.find(agent => agent.name.toLowerCase() === moderatorName.toLowerCase());
    if (matched) return matched;
  }
  return agents.find(agent => {
    const text = `${agent.name} ${agent.role}`.toLowerCase();
    return text.includes('moderator') || text.includes('lead') || text.includes('director') || text.includes('reviewer')
      || text.includes('editor') || text.includes('risk manager');
  }) || agents[0];
}

export async function evaluateDiscussionLoop(
  dirPath: string,
  discussionId: string,
  moderatorName: string | undefined,
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  appendMessageCreatedEvent: (scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage) => Promise<void>,
  appendActionEvents: (sourceDiscussionId: string, executed: ActionExecutionResult) => Promise<void>
): Promise<QualityGateResult> {
  if (!/^discussion-[\w-]+$/.test(discussionId)) {
    throw new Error('Invalid discussion id.');
  }

  const discussionsDir = path.join(dirPath, '.room', 'discussions');
  const logPath = path.join(discussionsDir, `${discussionId}.json`);
  const markdownLogPath = path.join(discussionsDir, `${discussionId}.md`);
  const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
  ensureStableMessageIds(discussionId, discussionLog.messages);
  const agents = await loadAgents(dirPath);
  const moderator = pickModerator(agents, moderatorName);

  if (!moderator) {
    throw new Error('No AI member is available to run the quality gate.');
  }

  await assertAgentExecutionAllowed(moderator);
  const provider = getProvider(moderator);
  const transcript = renderDiscussionMarkdown(discussionLog);
  const prompt = `Evaluate whether this ROOM chat has answered the user's goal well enough to stop.

Do not add new creative or implementation work unless it is needed to explain a gap.
Be strict about vagueness, contradictions, missing decisions, weak next steps, or agents ignoring each other.

Return exactly these sections:
STATUS: PASS | NEEDS_MORE_DISCUSSION
SUMMARY:
GAPS:
NEXT_ROUND_INSTRUCTIONS:

Rules:
- Use PASS only when the chat is coherent, useful, and has enough concrete output for the user's request.
- Use NEEDS_MORE_DISCUSSION when another focused round would materially improve the result.
- If NEEDS_MORE_DISCUSSION, NEXT_ROUND_INSTRUCTIONS must tell the next agents exactly what to fix or deepen.
- Keep the same natural language as the chat unless the user explicitly asked otherwise.

Runtime actions (optional):
You may also emit runtime actions for the ROOM engine to execute. Put each action in its own fenced code block labeled room-action containing one JSON object:
- {"action": "continue", "instructions": "<what the next round must fix>"} - force one more focused round.
- {"action": "stop", "reason": "<why the chat is done>"} - stop the discussion now.
- {"action": "create_task", "title": "...", "details": "...", "kind": "epic|task|subtask", "parent": "<parent card title>"} - add a card to the project task board.
- {"action": "create_adr", "title": "...", "context": "...", "decision": "..."} - record an architecture decision the chat clearly made.
Only emit create_task or create_adr for outcomes the chat actually agreed on. The STATUS line is still required.

Chat transcript:
${transcript}`;

  const systemPrompt = `${moderator.systemPrompt}

${LANGUAGE_POLICY}

${WORKSPACE_BOUNDARY_POLICY}

You are the ROOM quality gate. Your job is to decide whether the current chat is good enough or needs one more focused discussion round.`;

  const content = stripExternalFileLinks(await provider.execute(prompt, systemPrompt), dirPath);
  const { actions, errors: actionErrors } = parseModeratorActions(content);
  const executed = await executeModeratorActions(dirPath, actions, discussionId);
  await appendActionEvents(discussionId, executed);
  executed.errors.push(...actionErrors);

  const strippedContent = stripActionBlocks(content);
  const result = parseQualityGateResult(strippedContent || content);
  if (executed.control === 'stop') {
    result.status = 'PASS';
  } else if (executed.control === 'continue') {
    result.status = 'NEEDS_MORE_DISCUSSION';
    if (executed.controlInstructions) {
      result.nextRoundInstructions = executed.controlInstructions;
    }
  }
  result.executed = executed;

  const actionNotes = [
    ...executed.createdTaskCards.map(card => `[Moderator action: created task card ${card.id} - ${card.title}]`),
    ...executed.createdAdrs.map(adr => `[Moderator action: created ${adr.filename}]`),
    ...executed.errors.map(message => `[Moderator action error: ${message}]`)
  ].join('\n');
  const displayContent = [strippedContent || content.trim(), actionNotes].filter(Boolean).join('\n\n');

  const contextMessages = discussionLog.messages.map((message, index) => ({
    id: message.id,
    promptNumber: index + 1,
    agentName: message.agentName,
    providerName: message.providerName,
    timestamp: message.timestamp
  }));

  discussionLog.messages.push({
    id: nextStableMessageId(discussionId, discussionLog.messages),
    type: 'agent',
    agentName: moderator.name,
    providerName: moderator.provider,
    content: displayContent,
    timestamp: new Date().toLocaleTimeString(),
    contextMessages
  });
  await appendMessageCreatedEvent('discussion', discussionId, discussionLog.messages[discussionLog.messages.length - 1]);
  discussionLog.status = result.status === 'PASS' ? 'approved' : 'needs_revision';

  await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
  await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');

  return result;
}

export async function generateTasksFromDiscussionLoop(
  dirPath: string,
  discussionId: string,
  moderatorName: string | undefined,
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  appendActionEvents: (sourceDiscussionId: string, executed: ActionExecutionResult) => Promise<void>
): Promise<{ createdTaskCards: TaskCard[]; errors: string[] }> {
  if (!/^discussion-[\w-]+$/.test(discussionId)) {
    throw new Error('Invalid discussion id.');
  }

  const logPath = path.join(dirPath, '.room', 'discussions', `${discussionId}.json`);
  const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
  ensureStableMessageIds(discussionId, discussionLog.messages);
  const agents = await loadAgents(dirPath);
  const moderator = pickModerator(agents, moderatorName);
  if (!moderator) {
    throw new Error('No AI member is available to generate tasks.');
  }

  await assertAgentExecutionAllowed(moderator);
  const provider = getProvider(moderator);
  const transcript = renderDiscussionMarkdown(discussionLog);
  const prompt = `Convert the outcome of this ROOM chat into a structured task board plan.

Output requirements:
- Output ONLY fenced code blocks labeled room-action, one JSON object per block. No prose outside the blocks.
- Start with exactly one epic block: {"action": "create_task", "kind": "epic", "title": "<the discussion outcome>", "details": "<one-line goal>"}
- Add one block per concrete task: {"action": "create_task", "kind": "task", "title": "...", "details": "...", "parent": "<epic title>"}
- Add subtask blocks for implementation items: {"action": "create_task", "kind": "subtask", "title": "...", "parent": "<task title>"}
- Keep titles short and actionable. Skip work the chat did not actually agree on.
- Use the same natural language as the chat.

Chat transcript:
${transcript}`;

  const systemPrompt = `${moderator.systemPrompt}

${LANGUAGE_POLICY}

${WORKSPACE_BOUNDARY_POLICY}

You convert finished ROOM chats into actionable task plans for the project task board.`;

  const content = stripExternalFileLinks(await provider.execute(prompt, systemPrompt), dirPath);
  const { actions, errors } = parseModeratorActions(content);
  const taskActions = actions.filter(action => action.action === 'create_task');
  if (taskActions.length === 0) {
    throw new Error('The moderator did not produce any create_task actions. Try again or pick another moderator.');
  }

  const executed = await executeModeratorActions(dirPath, taskActions, discussionId);
  await appendActionEvents(discussionId, executed);
  return { createdTaskCards: executed.createdTaskCards, errors: [...errors, ...executed.errors] };
}
