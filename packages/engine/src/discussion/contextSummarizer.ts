import { Provider } from '../providers/provider.js';
import { PromptHistoryMessage } from './contextCompiler.js';

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

Omitted messages:
${transcript}`;

  const summary = await provider.execute(prompt, systemPrompt);
  return truncateSummary(summary.trim(), policy.maxSummaryChars);
}

export function truncateSummary(summary: string, maxSummaryChars: number): string {
  if (summary.length <= maxSummaryChars) {
    return summary;
  }
  return `${summary.slice(0, maxSummaryChars).trimEnd()}\n\n[Summary truncated to ${maxSummaryChars} characters.]`;
}

function formatSummaryInputMessage(index: number, message: PromptHistoryMessage): string {
  const label = message.type === 'user'
    ? message.agentName
    : `${message.agentName} (${message.providerName})`;
  return `--- Message ${index}: ${label} ---\n${message.content}`;
}
