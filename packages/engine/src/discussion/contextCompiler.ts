export interface PromptHistoryMessage {
  id?: string;
  type?: 'user' | 'agent';
  agentName: string;
  providerName: string;
  content: string;
  timestamp: string;
}

export interface PromptContextMessage {
  id?: string;
  promptNumber: number;
  logIndex: number;
  type?: 'user' | 'agent';
  agentName: string;
  providerName: string;
  timestamp: string;
}

export interface DiscussionContextOptions {
  maxRecentMessages: number;
  keepFirstUserMessage: boolean;
  keepLatestUserMessage: boolean;
  summary?: string;
}

export interface CompiledDiscussionContext {
  historyBlock: string;
  projectContextBlock: string;
  priorMessageInstruction: string;
  includedMessages: PromptContextMessage[];
  includedIndexes: number[];
  omittedIndexes: number[];
  summaryCandidateIndexes: number[];
  omittedMessageCount: number;
  summaryUsed: boolean;
  totalLogMessages: number;
  metrics: {
    rawHistoryChars: number;
    compiledHistoryChars: number;
    rawProjectContextChars: number;
    compiledProjectContextChars: number;
  };
}

export const DEFAULT_DISCUSSION_CONTEXT_OPTIONS: DiscussionContextOptions = {
  maxRecentMessages: 12,
  keepFirstUserMessage: true,
  keepLatestUserMessage: true,
  summary: undefined
};

export function compileDiscussionContext(
  messages: PromptHistoryMessage[],
  projectContext: string,
  options: Partial<DiscussionContextOptions> = {}
): CompiledDiscussionContext {
  const resolvedOptions = {
    ...DEFAULT_DISCUSSION_CONTEXT_OPTIONS,
    ...options
  };
  const includedIndexes = selectPromptHistoryIndexes(messages, resolvedOptions);
  const includedMessagesForHistory = includedIndexes.map(index => messages[index]);
  const includedMessages = includedMessagesForHistory.map((message, promptIndex) => (
    toPromptContextMessage(message, promptIndex + 1, includedIndexes[promptIndex])
  ));
  const omittedIndexes = messages
    .map((_, index) => index)
    .filter(index => !includedIndexes.includes(index));
  const summaryCandidateIndexes = omittedIndexes.filter(index => isSummaryCandidateMessage(messages[index]));
  const omittedMessageCount = omittedIndexes.length;
  const rawHistory = messages.map((message, index) => formatMessageForPromptHistory(message, index + 1)).join('\n\n');
  const historyBody = includedMessagesForHistory
    .map((message, promptIndex) => formatMessageForPromptHistory(message, promptIndex + 1))
    .join('\n\n');
  const omissionNote = omittedMessageCount > 0
    ? `The full discussion log has ${messages.length} message(s). This prompt includes ${includedIndexes.length} message(s); ${omittedMessageCount} older message(s) are omitted from this prompt.`
    : `The full discussion log has ${messages.length} message(s). All messages are included in this prompt.`;
  const summaryBlock = resolvedOptions.summary?.trim()
    ? `\n\n=== Summary of Omitted Messages ===\n${resolvedOptions.summary.trim()}\n\n=== Included Messages ===`
    : '';
  const historyBlock = `${omissionNote}${summaryBlock}\n\n${historyBody}`.trim();
  const compiledProjectContext = dedupeExactBlocks(projectContext) || '(No workspace context provided.)';
  const projectContextBlock = `=== Project Context ===\n${compiledProjectContext}`;
  const priorMessageInstruction = buildPriorMessageInstruction(includedMessages.length, omittedMessageCount);

  return {
    historyBlock,
    projectContextBlock,
    priorMessageInstruction,
    includedMessages,
    includedIndexes,
    omittedIndexes,
    summaryCandidateIndexes,
    omittedMessageCount,
    summaryUsed: !!resolvedOptions.summary?.trim(),
    totalLogMessages: messages.length,
    metrics: {
      rawHistoryChars: rawHistory.length,
      compiledHistoryChars: historyBlock.length,
      rawProjectContextChars: projectContext.length,
      compiledProjectContextChars: projectContextBlock.length
    }
  };
}

function selectPromptHistoryIndexes(
  messages: PromptHistoryMessage[],
  options: DiscussionContextOptions
): number[] {
  const indexes = new Set<number>();
  const recentStart = Math.max(0, messages.length - Math.max(1, options.maxRecentMessages));

  for (let index = recentStart; index < messages.length; index++) {
    indexes.add(index);
  }

  if (options.keepFirstUserMessage) {
    const firstUserIndex = messages.findIndex(message => message.type === 'user');
    if (firstUserIndex >= 0) {
      indexes.add(firstUserIndex);
    }
  }

  if (options.keepLatestUserMessage) {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].type === 'user') {
        indexes.add(index);
        break;
      }
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

function buildPriorMessageInstruction(includedMessageCount: number, omittedMessageCount: number): string {
  if (includedMessageCount === 0) {
    return '\n\nYou are the first AI member to respond. Establish a useful starting point for the later members.';
  }

  const omissionClause = omittedMessageCount > 0
    ? ` ${omittedMessageCount} older message(s) exist in the full log but are not included in this prompt, so do not claim to have read them unless summarized here.`
    : '';
  return `\n\nYou have ${includedMessageCount} previous chat message(s) included in the discussion history for this prompt, including the user's latest message.${omissionClause} Explicitly build on, refine, challenge, or resolve points from the included history instead of answering as a standalone first response. When recording references, cite the visible Message number from this prompt.`;
}

function toPromptContextMessage(message: PromptHistoryMessage, promptNumber: number, logIndex: number): PromptContextMessage {
  return {
    id: message.id,
    promptNumber,
    logIndex,
    type: message.type || 'agent',
    agentName: message.agentName,
    providerName: message.providerName,
    timestamp: message.timestamp
  };
}

function formatMessageForPromptHistory(message: PromptHistoryMessage, promptNumber: number): string {
  if (message.type === 'user') {
    return `--- Message ${promptNumber}: ${message.agentName} ---\n${message.content}`;
  }

  const cleanedContent = cleanAgentUserContent(message.content);
  const content = isOnlyOmissionNotes(cleanedContent)
    ? '[Previous Local CLI action narration omitted.]'
    : cleanedContent;
  return `--- Message ${promptNumber}: ${message.agentName} (${message.providerName}) ---\n${content}`;
}

function isSummaryCandidateMessage(message: PromptHistoryMessage): boolean {
  const cleanedContent = cleanAgentUserContent(message.content);
  return !!cleanedContent && !isOnlyOmissionNotes(cleanedContent);
}

function cleanAgentUserContent(content: string): string {
  const lines = content.split('\n');
  let omitted = 0;
  let actionNarration = 0;
  const kept = lines.filter((line) => {
    if (isLikelyGeneratedArtifactLine(line)) {
      omitted += 1;
      return false;
    }
    if (isToolNarrationLine(line)) {
      actionNarration += 1;
      return false;
    }
    return true;
  });
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (omitted === 0 && actionNarration === 0) return content.trim();
  const notes = [
    omitted > 0 ? `[Generated build artifact omitted: ${omitted} minified line${omitted === 1 ? '' : 's'}.]` : '',
    actionNarration > 0 ? `[Tool/action narration omitted: ${actionNarration} line${actionNarration === 1 ? '' : 's'}.]` : ''
  ].filter(Boolean);
  return cleaned ? `${cleaned}\n\n${notes.join('\n')}` : notes.join('\n');
}

function isLikelyGeneratedArtifactLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 320) return false;
  const whitespaceRatio = (trimmed.match(/\s/g) || []).length / trimmed.length;
  const punctuationRatio = (trimmed.match(/[{};:(),.=#[\]$]/g) || []).length / trimmed.length;
  const hasCssBundlePattern = /(?:^|[}.])[-_a-zA-Z0-9]+[.#:_a-zA-Z0-9 -]*\{[^}]+[:;]/.test(trimmed) || /--[a-z0-9-]+:\s*[^;]+;/.test(trimmed);
  const hasJsBundlePattern = /\b(?:function|const|let|var)\b.{80,}[{};]/.test(trimmed) || /=>\{.{80,}/.test(trimmed);
  const hasSourceMapPattern = /sourceMappingURL|webpack|vite|rollup|__vite|React\.createElement/.test(trimmed);
  return whitespaceRatio < 0.18 && punctuationRatio > 0.12 && (hasCssBundlePattern || hasJsBundlePattern || hasSourceMapPattern);
}

function isToolNarrationLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) return false;
  if (/^I'?m Antigravity\b/i.test(normalized)) return true;
  if (/^It looks like you'?ve selected the\b/i.test(normalized)) return true;
  if (/^I am powered by\b/i.test(normalized)) return true;
  if (/^I am (currently )?running (on|Gemini|Claude|Codex|GPT)/i.test(normalized)) return true;
  if (/^I am running\b/i.test(normalized)) return true;
  if (/^(I will|I'll|Let'?s|I am going to)\s+(list|read|view|inspect|check|open|look at|see|search|run)\b/i.test(normalized)) return true;
  if (/^I will (list|view|read) the contents of\b/i.test(normalized)) return true;
  if (/^Let's (list|read|view|see|check)\b/i.test(normalized)) return true;
  return false;
}

function isOnlyOmissionNotes(content: string): boolean {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(line => /^\[[^\]]+ omitted:?\s*.*\]$/.test(line));
}

function dedupeExactBlocks(content: string): string {
  const blocks = content.split(/\n{2,}/);
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  }

  return deduped.join('\n\n');
}
