import * as path from 'path';
import * as fs from 'fs/promises';
import type { AgentConfig } from '../agents/registry.js';
import { Provider } from '../providers/provider.js';
import type { DiscussionMessage, CodingTaskResult, DiscussionLog } from './types.js';
import { parseMessageReferences, type MessageReference } from './references.js';
import type { PromptContextMessage } from './contextCompiler.js';

export const LANGUAGE_POLICY = `=== Language Policy ===
Respond in the same natural language the user uses in the current discussion topic.
If the user mixes languages, preserve that mix when it helps clarity.
Do not force Thai, English, or any other default language unless the user explicitly asks for it.
Keep code identifiers, file paths, commands, API names, and quoted source text in their original language.`;

export const USER_FACING_OUTPUT_POLICY = `=== User-Facing Output Policy ===
Return only the useful answer for the user in clean Markdown.
Do not dump raw JSON events, HTML, CSS, bundled JavaScript, source maps, lockfile content, or generated build artifacts.
When you need to mention source code or files, summarize the relevant behavior and cite concise file paths or tiny snippets only.
Ignore generated directories and artifacts such as dist, dist-packaged, build, coverage, .next, node_modules, minified assets, and source maps unless the user explicitly asks to inspect them.`;

export const WORKSPACE_BOUNDARY_POLICY = `=== Workspace Boundary Policy ===
The active workspace root is the only durable project workspace.
Do not create, save, update, or link files in provider-specific memory folders, CLI brain folders, home-directory agent stores, or temporary scratch workspaces.
If you create or mention durable files, they must be inside the active workspace root, preferably under .room/ for ROOM artifacts.
Do not return file:// links outside the active workspace.
For summaries and discussion replies, return Markdown content only; ROOM will save artifacts into the workspace when appropriate.`;

export const LOCAL_CLI_OUTPUT_POLICY = `=== Local CLI Agent Policy ===
Use only the prompt, discussion history, selected context, active skills, and project context provided here.
Do not inspect the workspace with shell commands, file listing, permission checks, config reads, or tool calls unless the user's current request explicitly asks you to perform that inspection.
Do not narrate intended tool use such as "I will list files", "Let's read config", or "I am running on model...".
If you cannot answer from the provided context, say what specific context is missing and ask for it.`;

export const REFERENCE_TRACING_PROTOCOL = `=== Reference Tracing Protocol ===
At the very end of your reply, append exactly one fenced code block labeled room-refs recording which prior messages you actually used:
\`\`\`room-refs
{"references": [{"message": <visible Message number>, "author": "<agent or user name>", "reason": "<why you used it>"}]}
\`\`\`
Use the visible Message number shown in the prompt history, not the full log number. List only messages that genuinely shaped your answer. If you used none, output {"references": []}. Do not mention this block in your prose.`;

export function composeAgentSystemPrompt(basePrompt: string, localCliAgent: boolean, ...sections: string[]): string {
  return [
    basePrompt,
    LANGUAGE_POLICY,
    USER_FACING_OUTPUT_POLICY,
    WORKSPACE_BOUNDARY_POLICY,
    localCliAgent ? LOCAL_CLI_OUTPUT_POLICY : '',
    ...sections.filter(section => section.trim())
  ].join('\n\n');
}

export function isDeveloperAgent(agent: AgentConfig): boolean {
  const text = `${agent.name} ${agent.role}`.toLowerCase();
  if (text.includes('planner')) return false;
  return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('coder');
}

export async function cleanUpParentTaskFiles(dirPath: string, parentId: string): Promise<void> {
  if (!parentId) return;
  try {
    const tasksDir = path.join(dirPath, '.room', 'tasks');
    const parentJsonPath = path.join(tasksDir, `${parentId}.json`);
    const parentMarkdownPath = path.join(tasksDir, `${parentId}.md`);
    const parentArtifactPath = path.join(dirPath, '.room', 'documents', `${parentId}-artifact.md`);
    
    let ancestorId = '';
    try {
      const parentContent = await fs.readFile(parentJsonPath, 'utf-8');
      const parentMeta = JSON.parse(parentContent);
      ancestorId = parentMeta.continuedFromTaskId || '';
    } catch {
      // Ignore
    }

    await fs.unlink(parentJsonPath).catch(() => {});
    await fs.unlink(parentMarkdownPath).catch(() => {});
    await fs.unlink(parentArtifactPath).catch(() => {});
    
    if (ancestorId) {
      await cleanUpParentTaskFiles(dirPath, ancestorId);
    }
  } catch {
    // Ignore
  }
}

export function isLikelyGeneratedArtifactLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 320) return false;
  const whitespaceRatio = (trimmed.match(/\s/g) || []).length / trimmed.length;
  const punctuationRatio = (trimmed.match(/[{};:(),.=#[\]$]/g) || []).length / trimmed.length;
  const hasCssBundlePattern = /(?:^|[}.])[-_a-zA-Z0-9]+[.#:_a-zA-Z0-9 -]*\{[^}]+[:;]/.test(trimmed) || /--[a-z0-9-]+:\s*[^;]+;/.test(trimmed);
  const hasJsBundlePattern = /\b(?:function|const|let|var)\b.{80,}[{};]/.test(trimmed) || /=>\{.{80,}/.test(trimmed);
  const hasSourceMapPattern = /sourceMappingURL|webpack|vite|rollup|__vite|React\.createElement/.test(trimmed);
  return whitespaceRatio < 0.18 && punctuationRatio > 0.12 && (hasCssBundlePattern || hasJsBundlePattern || hasSourceMapPattern);
}

export function cleanAgentUserContent(content: string, workspaceRoot: string): string {
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
  const stripped = stripExternalFileLinks(cleaned, workspaceRoot);
  if (omitted === 0 && actionNarration === 0) return stripped.trim();
  const notes = [
    omitted > 0 ? `[Generated build artifact omitted: ${omitted} minified line${omitted === 1 ? '' : 's'}.]` : '',
    actionNarration > 0 ? `[Tool/action narration omitted: ${actionNarration} line${actionNarration === 1 ? '' : 's'}.]` : ''
  ].filter(Boolean);
  return stripped ? `${stripped}\n\n${notes.join('\n')}` : notes.join('\n');
}

export function cleanAgentStreamChunk(chunk: string): string {
  if (isToolNarrationLine(chunk)) return '';
  if (!isLikelyGeneratedArtifactLine(chunk)) return chunk;
  return '\n[Generated build artifact omitted.]\n';
}

export function isOnlyOmissionNotes(content: string): boolean {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(line => /^\[[^\]]+ omitted:?\s*.*\]$/.test(line));
}

export function localCliNoFinalAnswerMessage(agentName: string): string {
  return `[System Notice from ${agentName}]: This Local CLI did not produce a final answer. It only emitted tool/action narration. The agent should answer from the provided ROOM context; if it must inspect files directly, enable an explicit tool-capable workflow for that agent.`;
}

export function formatMessageOrdinal(value: number): string {
  return String(value).padStart(4, '0');
}

export function messageIdFor(scopeId: string, sequence: number): string {
  return `${scopeId}:message-${formatMessageOrdinal(sequence)}`;
}

export function ensureStableMessageIds(scopeId: string, messages: DiscussionMessage[]): void {
  messages.forEach((message, index) => {
    if (!message.id) {
      message.id = messageIdFor(scopeId, index + 1);
    }
  });
}

export function nextStableMessageId(scopeId: string, messages: DiscussionMessage[]): string {
  return messageIdFor(scopeId, messages.length + 1);
}

export function isToolNarrationLine(line: string): boolean {
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

export function safeDocumentSlug(input: string): string {
  const slug = (input || 'discussion')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'discussion';
}

export function stripExternalFileLinks(markdown: string, workspaceRoot: string): string {
  const normalizedRoot = path.resolve(workspaceRoot);
  const isInsideWorkspace = (fileUrl: string): boolean => {
    try {
      const url = new URL(fileUrl);
      if (url.protocol !== 'file:') return true;
      const filePath = decodeURIComponent(url.pathname);
      const resolved = path.resolve(filePath);
      return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`);
    } catch {
      return true;
    }
  };

  return markdown
    .replace(/\[([^\]]+)\]\((file:\/\/[^)\s]+)\)/g, (_match, label: string, fileUrl: string) => {
      return isInsideWorkspace(fileUrl) ? _match : label;
    })
    .replace(/\bfile:\/\/[^\s)]+/g, (fileUrl: string) => {
      return isInsideWorkspace(fileUrl) ? fileUrl : '[external file path removed]';
    });
}

export function renderDiscussionMarkdown(log: DiscussionLog): string {
  const messages = log.messages.map((message: DiscussionMessage, index: number) => {
    const messageIdLine = message.id ? `Message ID: ${message.id}\n\n` : '';
    const providerLabel = message.modelName || message.providerName;
    if (message.type === 'user') {
      return `## ${index + 1}. ${message.agentName}\n\n${messageIdLine}${message.content.trim()}\n`;
    }

    const contextMessages = message.contextMessages || [];
    const contextSummary = contextMessages.length > 0
      ? contextMessages.map((contextMessage) => `- ${contextMessage.promptNumber ? `Message ${contextMessage.promptNumber}: ` : ''}${contextMessage.agentName} (${contextMessage.providerName}) at ${contextMessage.timestamp}${contextMessage.id ? ` [${contextMessage.id}]` : ''}`).join('\n')
      : '- Current user message only; no previous chat messages yet.';

    const references = message.references || [];
    const referenceSection = references.length > 0
      ? `\n### References used\n${references.map((ref) => `- ${ref.message ? `Message ${ref.message}: ` : ''}${ref.author || ref.messageId || 'Unknown'}${ref.messageId ? ` [${ref.messageId}]` : ''}${ref.reason ? ` — ${ref.reason}` : ''}`).join('\n')}\n`
      : '';

    return `## ${index + 1}. ${message.agentName} (${providerLabel})\n\n${messageIdLine}### Context received\n${contextSummary}\n${referenceSection}\n### Response\n\n${message.content.trim()}\n`;
  }).join('\n');

  return `# ${log.title}\n\n## Current Topic\n${log.topic || 'Untitled'}\n\n## Status\n${log.status}\n\n## Transcript\n${messages || 'No messages yet.'}\n`;
}

export function renderCodingTaskMarkdown(result: CodingTaskResult): string {
  const messages = result.messages.map((message: DiscussionMessage, index: number) => {
    const providerLabel = message.modelName || message.providerName;
    const label = message.type === 'user'
      ? message.agentName
      : `${message.agentName} (${providerLabel})`;
    const messageIdLine = message.id ? `Message ID: ${message.id}\n\n` : '';
    return `## ${index + 1}. ${label}\n\n${messageIdLine}${message.content.trim()}\n`;
  }).join('\n');

  return `# ${result.title}\n\n## Task\n${result.task}\n\n## Task Type\n${result.taskType || 'general'}\n\n## Status\n${result.status}\n\n## Cycles\n${result.cycles}\n\n## Approved By\n${result.approvedBy && result.approvedBy.length > 0 ? result.approvedBy.map((name: string) => `- ${name}`).join('\n') : '- Not approved yet'}\n\n## Artifact\n${result.artifactFilename ? result.artifactFilename : 'No artifact saved yet.'}\n\n## Status Summary\n${result.statusSummary || 'No status summary yet.'}\n\n## Transcript\n${messages || 'No messages yet.'}\n`;
}

export function renderTaskArtifact(result: CodingTaskResult, doerMessage: DiscussionMessage | null): string {
  const artifactTitle = result.taskType === 'coding'
    ? `Implementation Report: ${result.task}`
    : `Task Artifact: ${result.task}`;
  const source = doerMessage?.content?.trim() || 'No deliverable content was produced.';
  return `# ${artifactTitle}\n\n## Task Type\n${result.taskType || 'general'}\n\n## Status\n${result.status}\n\n## Review Cycles\n${result.cycles}\n\n## Approved By\n${result.approvedBy && result.approvedBy.length > 0 ? result.approvedBy.map((name: string) => `- ${name}`).join('\n') : '- Not approved yet'}\n\n## Summary\n${result.statusSummary || 'No status summary available.'}\n\n## Deliverable\n\n${source}\n`;
}

export interface AgentStepResult {
  output: string;
  references: MessageReference[];
  agentFailed: boolean;
}

export interface AgentStepOptions {
  onEvent?: (event: {
    type: string;
    discussionId: string;
    agentName: string;
    providerName: string;
    modelName?: string;
    round: number;
    chunk?: string;
    error?: string;
  }) => void;
}

export async function executeAgentStep(
  provider: Provider,
  agent: AgentConfig,
  prompt: string,
  systemPrompt: string,
  dirPath: string,
  taskId: string,
  cycle: number,
  includedMessages: PromptContextMessage[],
  options: AgentStepOptions
): Promise<AgentStepResult> {
  let output = '';
  let references: MessageReference[] = [];
  let agentFailed = false;
  try {
    output = await provider.execute(prompt, systemPrompt, {
      onChunk: (chunk: string) => {
        options.onEvent?.({
          type: 'agent_chunk',
          discussionId: taskId,
          agentName: agent.name,
          providerName: agent.provider,
          ...(agent.modelName ? { modelName: agent.modelName } : {}),
          round: cycle,
          chunk: cleanAgentStreamChunk(chunk)
        });
      }
    });
    output = cleanAgentUserContent(output, dirPath);
    const parsedRefs = parseMessageReferences(output, includedMessages);
    references = parsedRefs.references;
    if (parsedRefs.cleaned) {
      output = parsedRefs.cleaned;
    }
    if (agent.provider === 'Local CLI' && isOnlyOmissionNotes(output)) {
      output = localCliNoFinalAnswerMessage(agent.name);
      agentFailed = true;
    }
  } catch (err: unknown) {
    agentFailed = true;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Error executing agent ${agent.name}:`, errMsg);
    options.onEvent?.({
      type: 'agent_error',
      discussionId: taskId,
      agentName: agent.name,
      providerName: agent.provider,
      ...(agent.modelName ? { modelName: agent.modelName } : {}),
      round: cycle,
      error: errMsg
    });
    output = cleanAgentUserContent(`[System Error from ${agent.name}]: Failed to execute provider ${agent.provider}. Details: ${errMsg}`, dirPath);
  }
  return { output, references, agentFailed };
}

export const DOER_WORK_INSTRUCTIONS_CODING = `- Work only inside the workspace root shown above.
- If your provider can edit files or run commands, implement the requested change now.
- If you cannot edit files directly, provide an exact patch-level implementation plan and say clearly that no files were changed.
- After working, report changed files, important decisions, validation commands run, and anything still blocked.`;

export const DOER_WORK_INSTRUCTIONS_GENERAL = `- Produce the requested work artifact now, not only a plan.
- Use the workspace context and selected references as source material.
- If the work should become a document, scene, research memo, decision note, checklist, or production plan, write it in clean Markdown.
- After working, report the artifact produced, decisions made, sources or context used, and anything still blocked.`;

export const REVIEWER_RULES_CODING = `- If your provider can inspect files or run commands, inspect the actual workspace before approving.
- Prioritize correctness, regressions, missing tests, unsafe filesystem behavior, and whether the task was actually implemented.
- If changes are needed, make them concrete enough for the Developer to fix in the next cycle.`;

export const REVIEWER_RULES_GENERAL = `- Review the actual artifact or deliverable, not just the intent.
- Prioritize usefulness, correctness, coherence, missing context, audience fit, and whether the task goal was actually satisfied.
- If changes are needed, make them concrete enough for the Doer to fix in the next cycle.`;
