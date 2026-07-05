import { Provider } from '../providers/provider.js';
import { PromptHistoryMessage } from './contextCompiler.js';
import { trimTextToCharBoundary } from './tokenBudget.js';

export interface ContextSummaryPolicy {
  minSummaryCandidateMessages: number;
  minSummaryCandidateChars: number;
  maxSummaryChars: number;
}

export const DEFAULT_CONTEXT_SUMMARY_POLICY: ContextSummaryPolicy = {
  minSummaryCandidateMessages: 8,
  minSummaryCandidateChars: 12000,
  maxSummaryChars: 6000
};

export function shouldGenerateContextSummary(
  messages: PromptHistoryMessage[],
  candidateIndexes: number[],
  policy: ContextSummaryPolicy = DEFAULT_CONTEXT_SUMMARY_POLICY
): boolean {
  const candidateChars = candidateIndexes.reduce((total, index) => total + (messages[index]?.content.length || 0), 0);
  return candidateIndexes.length >= policy.minSummaryCandidateMessages
    || candidateChars >= policy.minSummaryCandidateChars;
}

export async function summarizeContextMessages(
  provider: Provider,
  systemPrompt: string,
  messages: PromptHistoryMessage[],
  candidateIndexes: number[],
  policy: ContextSummaryPolicy = DEFAULT_CONTEXT_SUMMARY_POLICY
): Promise<string> {
  const transcript = candidateIndexes
    .map(index => formatSummaryInputMessage(index, messages[index]))
    .join('\n\n');
  const prompt = `Summarize these omitted ROOM messages into durable context for future agent turns.

Preserve:
- user goals and constraints
- decisions made
- open findings or unresolved objections
- required changes
- files/modules mentioned
- current plan/status

Do not summarize recent messages that will be provided separately.
Keep it concise and avoid restating every message.
Keep the final summary under ${policy.maxSummaryChars} characters. If the source is large, prioritize decisions, constraints, unresolved findings, and concrete next steps over chronology.

Omitted messages:
${transcript}`;

  const summary = await provider.execute(prompt, systemPrompt);
  return truncateSummary(summary.trim(), policy.maxSummaryChars);
}

export const MAX_UNSUMMARIZED_OMITTED_MESSAGES = 4;

export async function updateContextSummary(
  provider: Provider,
  systemPrompt: string,
  previousSummary: string,
  messages: PromptHistoryMessage[],
  uncoveredIndexes: number[],
  policy: ContextSummaryPolicy = DEFAULT_CONTEXT_SUMMARY_POLICY
): Promise<string> {
  const transcript = uncoveredIndexes
    .map(index => formatSummaryInputMessage(index, messages[index]))
    .join('\n\n');
  const prompt = `Update this existing summary of omitted ROOM messages with the newly omitted messages below.

Existing summary:
${previousSummary}

Newly omitted messages:
${transcript}

Merge them into one updated summary. Preserve user goals and constraints, decisions made, open findings or unresolved objections, required changes, files/modules mentioned, and the current plan/status. Keep the result under ${policy.maxSummaryChars} characters. Return only the updated summary.`;

  const summary = await provider.execute(prompt, systemPrompt);
  return truncateSummary(summary.trim(), policy.maxSummaryChars);
}

export function truncateSummary(summary: string, maxSummaryChars: number): string {
  if (summary.length <= maxSummaryChars) {
    return summary;
  }
  const fitted = trimTextToCharBoundary(summary, maxSummaryChars);
  return `${fitted.text}\n\n[Summary truncated to ${maxSummaryChars} characters at the nearest readable boundary.]`;
}

function formatSummaryInputMessage(index: number, message: PromptHistoryMessage): string {
  const label = message.type === 'user'
    ? message.agentName
    : `${message.agentName} (${message.providerName})`;
  return `--- Message ${index}: ${label} ---\n${message.content}`;
}
