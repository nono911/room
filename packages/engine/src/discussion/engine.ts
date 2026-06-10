import * as fs from 'fs/promises';
import * as path from 'path';
import { loadAgents, AgentConfig } from '../agents/registry.js';
import { assertLocalCliExecutionAllowed } from '../agents/localCliPolicy.js';
import { GeminiProvider } from '../providers/gemini.js';
import { ClaudeProvider } from '../providers/claude.js';
import { CodexProvider } from '../providers/codex.js';
import { LocalCliProvider } from '../providers/localCli.js';
import { Provider } from '../providers/provider.js';
import { parseModeratorActions, stripActionBlocks } from './actions.js';
import { executeModeratorActions, ActionExecutionResult } from './actionExecutor.js';
import { TaskCard } from './taskBoard.js';
import { parseMessageReferences, MessageReference } from './references.js';
import { compileDiscussionContext, CompiledDiscussionContext, PromptHistoryMessage } from './contextCompiler.js';
import {
  ContextSummarySource,
  createContextSummaryCache,
  isReusableContextSummaryCache,
  readContextSummaryCache,
  writeContextSummaryCache
} from './contextSummaryCache.js';
import {
  DEFAULT_CONTEXT_SUMMARY_POLICY,
  shouldGenerateContextSummary,
  summarizeContextMessages
} from './contextSummarizer.js';
import { appendRoomEvents, NewRoomEvent } from '../events/eventLog.js';

export interface DiscussionMessage {
  id?: string;
  type?: 'user' | 'agent';
  agentName: string;
  providerName: string;
  content: string;
  timestamp: string;
  round?: number;
  references?: MessageReference[];
  contextMessages?: {
    id?: string;
    promptNumber?: number;
    logIndex?: number;
    type?: 'user' | 'agent';
    agentName: string;
    providerName: string;
    timestamp: string;
  }[];
}

export interface DiscussionLog {
  id: string;
  title: string;
  topic?: string;
  status: 'active' | 'completed' | 'approved' | 'needs_revision' | 'blocked';
  messages: DiscussionMessage[];
}

export type DiscussionEvent =
  | {
      type: 'discussion_started';
      discussionId: string;
      title: string;
    }
  | {
      type: 'agent_started';
      discussionId: string;
      agentName: string;
      providerName: string;
      role: string;
      round: number;
      timestamp: string;
    }
  | {
      type: 'agent_chunk';
      discussionId: string;
      agentName: string;
      providerName: string;
      round: number;
      chunk: string;
    }
  | {
      type: 'message_completed';
      discussionId: string;
      message: DiscussionMessage;
      round: number;
    }
  | {
      type: 'agent_error';
      discussionId: string;
      agentName: string;
      providerName: string;
      round: number;
      error: string;
    }
  | {
      type: 'discussion_completed';
      discussionId: string;
      log: DiscussionLog;
    };

export interface DiscussionRunOptions {
  onEvent?: (event: DiscussionEvent) => void;
  reviewMode?: boolean;
  additionalContext?: string;
  userLabel?: string;
}

export interface QualityGateResult {
  status: 'PASS' | 'NEEDS_MORE_DISCUSSION';
  content: string;
  nextRoundInstructions: string;
  executed?: ActionExecutionResult;
}

export interface CodingTaskResult {
  id: string;
  title: string;
  task: string;
  taskType?: string;
  status: 'approved' | 'needs_revision' | 'blocked';
  cycles: number;
  messages: DiscussionMessage[];
  markdownFilename: string;
  jsonFilename: string;
  artifactFilename?: string;
  approvedBy?: string[];
  statusSummary?: string;
}

export interface CodingTaskRunOptions {
  onEvent?: (event: DiscussionEvent) => void;
  additionalContext?: string;
  taskType?: string;
}

const LANGUAGE_POLICY = `=== Language Policy ===
Respond in the same natural language the user uses in the current discussion topic.
If the user mixes languages, preserve that mix when it helps clarity.
Do not force Thai, English, or any other default language unless the user explicitly asks for it.
Keep code identifiers, file paths, commands, API names, and quoted source text in their original language.`;

const DISCUSSION_PROTOCOL = `=== Discussion Protocol ===
This is a collaborative chat, not a set of isolated answers.
When there is prior chat history, explicitly reference at least one concrete point from the previous user or AI messages.
State whether you are building on, refining, challenging, or resolving that point before adding your own contribution.
Avoid restarting from scratch unless the user asks for a new direction.
Treat any "structured deliverable" sections in your persona as a flexible guide, not a rigid template: in open discussion, prioritize a natural, conversational reply that advances the topic, and reach for those sections only when they genuinely add clarity.`;

const REFERENCE_TRACING_PROTOCOL = `=== Reference Tracing Protocol ===
At the very end of your reply, append exactly one fenced code block labeled room-refs recording which prior messages you actually used:
\`\`\`room-refs
{"references": [{"message": <visible Message number>, "author": "<agent or user name>", "reason": "<why you used it>"}]}
\`\`\`
Use the visible Message number shown in the prompt history, not the full log number. List only messages that genuinely shaped your answer. If you used none, output {"references": []}. Do not mention this block in your prose.`;

const USER_FACING_OUTPUT_POLICY = `=== User-Facing Output Policy ===
Return only the useful answer for the user in clean Markdown.
Do not dump raw JSON events, HTML, CSS, bundled JavaScript, source maps, lockfile content, or generated build artifacts.
When you need to mention source code or files, summarize the relevant behavior and cite concise file paths or tiny snippets only.
Ignore generated directories and artifacts such as dist, dist-packaged, build, coverage, .next, node_modules, minified assets, and source maps unless the user explicitly asks to inspect them.`;

const WORKSPACE_BOUNDARY_POLICY = `=== Workspace Boundary Policy ===
The active workspace root is the only durable project workspace.
Do not create, save, update, or link files in provider-specific memory folders, CLI brain folders, home-directory agent stores, or temporary scratch workspaces.
If you create or mention durable files, they must be inside the active workspace root, preferably under .room/ for ROOM artifacts.
Do not return file:// links outside the active workspace.
For summaries and discussion replies, return Markdown content only; ROOM will save artifacts into the workspace when appropriate.`;

const LOCAL_CLI_OUTPUT_POLICY = `=== Local CLI Agent Policy ===
Use only the prompt, discussion history, selected context, active skills, and project context provided here.
Do not inspect the workspace with shell commands, file listing, permission checks, config reads, or tool calls unless the user's current request explicitly asks you to perform that inspection.
Do not narrate intended tool use such as "I will list files", "Let's read config", or "I am running on model...".
If you cannot answer from the provided context, say what specific context is missing and ask for it.`;

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

function cleanAgentStreamChunk(chunk: string): string {
  if (isToolNarrationLine(chunk)) return '';
  if (!isLikelyGeneratedArtifactLine(chunk)) return chunk;
  return '\n[Generated build artifact omitted.]\n';
}

function isOnlyOmissionNotes(content: string): boolean {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(line => /^\[[^\]]+ omitted:?\s*.*\]$/.test(line));
}

function localCliNoFinalAnswerMessage(agentName: string): string {
  return `[System Notice from ${agentName}]: This Local CLI did not produce a final answer. It only emitted tool/action narration. The agent should answer from the provided ROOM context; if it must inspect files directly, enable an explicit tool-capable workflow for that agent.`;
}

function formatMessageOrdinal(value: number): string {
  return String(value).padStart(4, '0');
}

function messageIdFor(scopeId: string, sequence: number): string {
  return `${scopeId}:message-${formatMessageOrdinal(sequence)}`;
}

function ensureStableMessageIds(scopeId: string, messages: DiscussionMessage[]): void {
  messages.forEach((message, index) => {
    if (!message.id) {
      message.id = messageIdFor(scopeId, index + 1);
    }
  });
}

// Message ids are positional: logs are append-only and ensureStableMessageIds runs
// before any append, so ids are always the contiguous sequence 1..length.
function nextStableMessageId(scopeId: string, messages: DiscussionMessage[]): string {
  return messageIdFor(scopeId, messages.length + 1);
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

function composeAgentSystemPrompt(basePrompt: string, localCliAgent: boolean, ...sections: string[]): string {
  return [
    basePrompt,
    LANGUAGE_POLICY,
    USER_FACING_OUTPUT_POLICY,
    WORKSPACE_BOUNDARY_POLICY,
    localCliAgent ? LOCAL_CLI_OUTPUT_POLICY : '',
    ...sections.filter(section => section.trim())
  ].join('\n\n');
}

function renderDiscussionMarkdown(log: DiscussionLog): string {
  const messages = log.messages.map((message, index) => {
    const messageIdLine = message.id ? `Message ID: ${message.id}\n\n` : '';
    if (message.type === 'user') {
      return `## ${index + 1}. ${message.agentName}

${messageIdLine}${message.content.trim()}
`;
    }

    const contextMessages = message.contextMessages || [];
    const contextSummary = contextMessages.length > 0
      ? contextMessages.map(contextMessage => `- ${contextMessage.promptNumber ? `Message ${contextMessage.promptNumber}: ` : ''}${contextMessage.agentName} (${contextMessage.providerName}) at ${contextMessage.timestamp}${contextMessage.id ? ` [${contextMessage.id}]` : ''}`).join('\n')
      : '- Current user message only; no previous chat messages yet.';

    const references = message.references || [];
    const referenceSection = references.length > 0
      ? `\n### References used\n${references.map(ref => `- ${ref.message ? `Message ${ref.message}: ` : ''}${ref.author || ref.messageId || 'Unknown'}${ref.messageId ? ` [${ref.messageId}]` : ''}${ref.reason ? ` — ${ref.reason}` : ''}`).join('\n')}\n`
      : '';

    return `## ${index + 1}. ${message.agentName} (${message.providerName})

${messageIdLine}### Context received
${contextSummary}
${referenceSection}
### Response

${message.content.trim()}
`;
  }).join('\n');

  return `# ${log.title}

## Current Topic
${log.topic || 'Untitled'}

## Status
${log.status}

## Transcript
${messages || 'No messages yet.'}
`;
}

function renderCodingTaskMarkdown(result: CodingTaskResult): string {
  const messages = result.messages.map((message, index) => {
    const label = message.type === 'user'
      ? message.agentName
      : `${message.agentName} (${message.providerName})`;
    const messageIdLine = message.id ? `Message ID: ${message.id}\n\n` : '';
    return `## ${index + 1}. ${label}

${messageIdLine}${message.content.trim()}
`;
  }).join('\n');

  return `# ${result.title}

## Task
${result.task}

## Task Type
${result.taskType || 'general'}

## Status
${result.status}

## Cycles
${result.cycles}

## Approved By
${result.approvedBy && result.approvedBy.length > 0 ? result.approvedBy.map(name => `- ${name}`).join('\n') : '- Not approved yet'}

## Artifact
${result.artifactFilename ? result.artifactFilename : 'No artifact saved yet.'}

## Status Summary
${result.statusSummary || 'No status summary yet.'}

## Transcript
${messages || 'No messages yet.'}
`;
}

function renderTaskArtifact(result: CodingTaskResult, doerMessage: DiscussionMessage | null): string {
  const artifactTitle = result.taskType === 'coding'
    ? `Implementation Report: ${result.task}`
    : `Task Artifact: ${result.task}`;
  const source = doerMessage?.content?.trim() || 'No deliverable content was produced.';
  return `# ${artifactTitle}

## Task Type
${result.taskType || 'general'}

## Status
${result.status}

## Review Cycles
${result.cycles}

## Approved By
${result.approvedBy && result.approvedBy.length > 0 ? result.approvedBy.map(name => `- ${name}`).join('\n') : '- Not approved yet'}

## Summary
${result.statusSummary || 'No status summary available.'}

## Deliverable
${source}
`;
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

export class DiscussionEngine {
  private dirPath: string;

  constructor(dirPath: string) {
    this.dirPath = dirPath;
  }

  private async appendEvent(input: NewRoomEvent): Promise<void> {
    await this.appendEvents([input]);
  }

  private async appendEvents(inputs: NewRoomEvent[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await appendRoomEvents(this.dirPath, inputs);
    } catch (err: any) {
      console.warn(`[Discussion Engine] Failed to append event(s) ${inputs.map(input => input.type).join(', ')}: ${err.message}`);
    }
  }

  private async appendMessageCreatedEvent(scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage): Promise<void> {
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

  private async appendReferenceEvents(scopeType: 'discussion' | 'coding-task', scopeId: string, message: DiscussionMessage): Promise<void> {
    if (!message.id || !message.references) return;
    const sourceMessageId = message.id;
    await this.appendEvents(message.references
      .filter(reference => reference.messageId)
      .map(reference => ({
        type: 'message.referenced',
        actor: message.agentName,
        source: { type: 'message', id: sourceMessageId },
        target: { type: 'message', id: reference.messageId! },
        data: {
          scopeType,
          scopeId,
          promptMessageNumber: reference.message,
          author: reference.author,
          reason: reference.reason
        }
      })));
  }

  private async appendActionEvents(sourceDiscussionId: string, executed: ActionExecutionResult): Promise<void> {
    await this.appendEvents([
      ...executed.createdTaskCards.map(card => ({
        type: 'task.created',
        source: { type: 'discussion', id: sourceDiscussionId },
        target: { type: 'task', id: card.id },
        data: {
          title: card.title,
          kind: card.kind,
          parentId: card.parentId
        }
      })),
      ...executed.createdAdrs.map(adr => ({
        type: 'adr.created',
        source: { type: 'discussion', id: sourceDiscussionId },
        target: { type: 'adr', id: adr.id },
        data: {
          filename: adr.filename
        }
      }))
    ]);
  }

  private getProvider(agent: AgentConfig): Provider {
    switch (agent.provider) {
      case 'Claude':
        return new ClaudeProvider({ modelName: agent.modelName });
      case 'Gemini':
        return new GeminiProvider({ modelName: agent.modelName });
      case 'Codex':
        return new CodexProvider({ modelName: agent.modelName });
      case 'Local CLI':
        return new LocalCliProvider({
          command: agent.command,
          cliPreset: agent.cliPreset,
          stdinFormat: agent.stdinFormat,
          cwd: this.dirPath,
          modelName: agent.modelName,
          permissionMode: agent.permissionMode || 'safe'
        });
      default:
      return new GeminiProvider({ modelName: agent.modelName });
    }
  }

  private async isDangerousLocalCliAllowed(): Promise<boolean> {
    try {
      const configPath = path.join(this.dirPath, '.room', 'config.json');
      const parsed = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { allowDangerousCli?: unknown };
      return parsed.allowDangerousCli === true;
    } catch {
      return false;
    }
  }

  private async assertAgentExecutionAllowed(agent: AgentConfig): Promise<void> {
    if (agent.provider === 'Local CLI') {
      assertLocalCliExecutionAllowed(agent, await this.isDangerousLocalCliAllowed());
    }
  }

  private pickContextSummaryAgent(agents: AgentConfig[]): AgentConfig | undefined {
    const nonLocalAgents = agents.filter(agent => agent.provider !== 'Local CLI');
    return nonLocalAgents.find(agent => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return text.includes('reporter') || text.includes('scribe') || text.includes('summary');
    }) || nonLocalAgents[0];
  }

  private async compileContextWithOptionalSummary(
    source: ContextSummarySource,
    contextId: string,
    messages: PromptHistoryMessage[],
    projectContext: string,
    agents: AgentConfig[]
  ): Promise<CompiledDiscussionContext> {
    const draftContext = compileDiscussionContext(messages, projectContext);
    const candidateIndexes = draftContext.summaryCandidateIndexes;
    if (candidateIndexes.length === 0) {
      return draftContext;
    }

    const cacheInput = { dirPath: this.dirPath, source, contextId };
    const existingCache = await readContextSummaryCache(cacheInput);
    if (isReusableContextSummaryCache(existingCache, messages, candidateIndexes)) {
      return compileDiscussionContext(messages, projectContext, {
        summary: existingCache.summary
      });
    }

    if (!shouldGenerateContextSummary(messages, candidateIndexes)) {
      return draftContext;
    }

    const summaryAgent = this.pickContextSummaryAgent(agents);
    if (!summaryAgent) {
      return draftContext;
    }

    try {
      await this.assertAgentExecutionAllowed(summaryAgent);
      const provider = this.getProvider(summaryAgent);
      const systemPrompt = composeAgentSystemPrompt(
        summaryAgent.systemPrompt,
        false,
        'You summarize omitted ROOM context into compact durable memory for future agent turns.'
      );
      const summary = await summarizeContextMessages(
        provider,
        systemPrompt,
        messages,
        candidateIndexes,
        DEFAULT_CONTEXT_SUMMARY_POLICY
      );
      const cache = createContextSummaryCache(source, contextId, messages, candidateIndexes, summary);
      await writeContextSummaryCache(cacheInput, cache);
      return compileDiscussionContext(messages, projectContext, { summary });
    } catch (err: any) {
      console.warn(`[Discussion Engine] Skipped context summary cache for ${contextId}: ${err.message}`);
      return draftContext;
    }
  }

  private async readFirstExistingFile(paths: string[]): Promise<string> {
    for (const filePath of paths) {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch {}
    }
    return '';
  }

  private async resolveSkillPath(skillFile: string): Promise<string> {
    const trimmedSkillFile = (skillFile || '').trim();
    if (/[\\/]/.test(trimmedSkillFile)) {
      throw new Error(`Unsafe skill filename: ${skillFile}`);
    }

    const safeName = path.basename(trimmedSkillFile);
    if (!safeName || !safeName.toLowerCase().endsWith('.md')) {
      throw new Error(`Unsafe or unsupported skill filename: ${skillFile}`);
    }

    const dirs = [
      path.resolve(this.dirPath, '.room', 'skills'),
      path.resolve(this.dirPath, '.room', 'roles')
    ];

    for (const skillsDir of dirs) {
      const resolvedPath = path.resolve(skillsDir, safeName);
      const relativeToSkills = path.relative(skillsDir, resolvedPath);
      if (relativeToSkills.startsWith('..') || path.isAbsolute(relativeToSkills)) {
        throw new Error(`Unsafe skill filename: ${skillFile}`);
      }

      try {
        await fs.access(resolvedPath);
        return resolvedPath;
      } catch {}
    }

    return path.resolve(dirs[0], safeName);
  }

  private isReviewerAgent(agent: AgentConfig): boolean {
    const name = agent.name.toLowerCase();
    const role = agent.role.toLowerCase();
    return name.includes('reviewer') || role.includes('review') || role.includes('audit');
  }

  private buildReviewProtocol(agent: AgentConfig): string {
    if (this.isReviewerAgent(agent)) {
      return `

=== Review Loop Protocol ===
You are responsible for finding and tracking implementation gaps.
Respond with these sections:
- OPEN_FINDINGS: unresolved blocker/major/minor findings, each with concrete rationale.
- RESOLVED_FINDINGS: findings from prior rounds that are now closed.
- REQUIRED_CHANGES: specific changes needed before approval.
- TEST_REQUIREMENTS: tests or checks that must pass before approval.
- APPROVAL_STATUS: NEEDS_REVISION or APPROVED.

Only output APPROVAL_STATUS: APPROVED when OPEN_FINDINGS is empty and the result is complete, actionable, and verifiable. If any meaningful gap remains, output APPROVAL_STATUS: NEEDS_REVISION.`;
    }

    return `

=== Review Loop Protocol ===
If prior agents raised OPEN_FINDINGS or REQUIRED_CHANGES, explicitly address each item before adding new scope. Produce a concrete, actionable result with affected areas, steps, and validation appropriate to the work.`;
  }

  private safeDocumentSlug(input: string): string {
    return safeDocumentSlug(input);
  }

  private isDeveloperAgent(agent: AgentConfig): boolean {
    const text = `${agent.name} ${agent.role}`.toLowerCase();
    if (text.includes('planner')) return false;
    return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('coder');
  }

  private parseCodingApproval(contents: string[]): boolean {
    if (contents.length === 0) return false;
    return contents.every(content => {
      return this.isExplicitlyApproved(content);
    });
  }

  private isExplicitlyApproved(content: string): boolean {
    const statusMatch = content.match(/^\s*-?\s*APPROVAL_STATUS\s*:\s*([A-Z_ -]+)\s*$/im);
    const status = statusMatch?.[1]?.trim().toUpperCase().replace(/\s+/g, '_');
    if (status !== 'APPROVED') {
      return false;
    }

    const openFindings = content.match(/(?:^|\n)\s*-?\s*OPEN_FINDINGS\s*:?\s*([\s\S]*?)(?=\n\s*-?\s*(?:RESOLVED_FINDINGS|REQUIRED_CHANGES|TEST_REQUIREMENTS|VALIDATION_NOTES|APPROVAL_STATUS)\s*:|\s*$)/i)?.[1]?.trim();
    if (!openFindings) {
      return true;
    }

    const normalized = openFindings
      .replace(/^[-*\s]+/gm, '')
      .replace(/\b(none|no open findings|empty|n\/a|null)\b/gi, '')
      .trim();
    return normalized.length === 0;
  }

  private extractTaskReviewSummary(contents: string[]): string {
    const summaries = contents.map((content, index) => {
      const reviewSummary = content.match(/REVIEW_SUMMARY\s*:?\s*([\s\S]*?)(?:\n-\s*OPEN_FINDINGS|\nOPEN_FINDINGS\s*:|\n-\s*REQUIRED_CHANGES|\nREQUIRED_CHANGES\s*:|\n-\s*VALIDATION_NOTES|\nVALIDATION_NOTES\s*:|\n-\s*APPROVAL_STATUS|\nAPPROVAL_STATUS\s*:|$)/i)?.[1]?.trim();
      const status = content.match(/APPROVAL_STATUS\s*:?\s*([^\n]+)/i)?.[1]?.trim();
      return `Reviewer ${index + 1}${status ? ` (${status})` : ''}: ${reviewSummary || content.trim().split('\n').slice(0, 3).join(' ')}`;
    });
    return summaries.join('\n');
  }

  private parseQualityGateResult(content: string): QualityGateResult {
    const statusLine = content
      .split('\n')
      .map(line => line.trim().toUpperCase())
      .find(line => {
        if (!line.startsWith('STATUS:')) return false;
        const hasPass = line.includes('PASS');
        const hasNeedsMoreDiscussion = line.includes('NEEDS_MORE_DISCUSSION');
        return hasPass !== hasNeedsMoreDiscussion;
      });
    const status = statusLine?.includes('PASS') ? 'PASS' : 'NEEDS_MORE_DISCUSSION';
    const nextMatch = content.match(/NEXT_ROUND_INSTRUCTIONS:\s*([\s\S]*)/i);
    const nextRoundInstructions = nextMatch?.[1]?.trim() || content.trim();
    return {
      status,
      content,
      nextRoundInstructions
    };
  }

  private pickModerator(agents: AgentConfig[], moderatorName?: string): AgentConfig | undefined {
    return (
      moderatorName
        ? agents.find(agent => agent.name.toLowerCase() === moderatorName.toLowerCase())
        : undefined
    ) || agents.find(agent => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return text.includes('moderator') || text.includes('lead') || text.includes('director') || text.includes('reviewer')
        || text.includes('editor') || text.includes('risk manager');
    }) || agents[0];
  }

  async evaluateDiscussion(
    discussionId: string,
    moderatorName?: string
  ): Promise<QualityGateResult> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const discussionsDir = path.join(this.dirPath, '.room', 'discussions');
    const logPath = path.join(discussionsDir, `${discussionId}.json`);
    const markdownLogPath = path.join(discussionsDir, `${discussionId}.md`);
    const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
    ensureStableMessageIds(discussionId, discussionLog.messages);
    const agents = await loadAgents(this.dirPath);
    const moderator = this.pickModerator(agents, moderatorName);

    if (!moderator) {
      throw new Error('No AI member is available to run the quality gate.');
    }

    await this.assertAgentExecutionAllowed(moderator);
    const provider = this.getProvider(moderator);
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

    const content = stripExternalFileLinks(await provider.execute(prompt, systemPrompt), this.dirPath);
    const { actions, errors: actionErrors } = parseModeratorActions(content);
    const executed = await executeModeratorActions(this.dirPath, actions, discussionId);
    await this.appendActionEvents(discussionId, executed);
    executed.errors.push(...actionErrors);

    const strippedContent = stripActionBlocks(content);
    const result = this.parseQualityGateResult(strippedContent || content);
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
      logIndex: index,
      type: message.type || 'agent',
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
    await this.appendMessageCreatedEvent('discussion', discussionId, discussionLog.messages[discussionLog.messages.length - 1]);
    discussionLog.status = result.status === 'PASS' ? 'approved' : 'needs_revision';

    await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
    await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');

    return result;
  }

  async summarizeDiscussion(
    discussionId: string,
    agentNames: string[] = [],
    summaryAgentOverride?: AgentConfig
  ): Promise<{ filename: string; content: string }> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const logPath = path.join(this.dirPath, '.room', 'discussions', `${discussionId}.json`);
    const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
    ensureStableMessageIds(discussionId, discussionLog.messages);
    const agents = await loadAgents(this.dirPath);
    const summaryAgent = summaryAgentOverride || agentNames
      .map(name => agents.find(a => a.name.toLowerCase() === name.toLowerCase()))
      .find((agent): agent is AgentConfig => !!agent) || agents.find(agent => {
        const text = `${agent.name} ${agent.role}`.toLowerCase();
        return text.includes('reporter') || text.includes('scribe') || text.includes('summary');
      }) || agents[0];

    if (!summaryAgent) {
      throw new Error('No AI member is available to summarize this chat.');
    }

    await this.assertAgentExecutionAllowed(summaryAgent);
    const provider = this.getProvider(summaryAgent);
    const transcript = renderDiscussionMarkdown(discussionLog);
    const prompt = `Summarize this ROOM chat into a durable workspace memory document.

Focus on the useful state that should survive after the raw chat becomes too long.
Do not merely restate every message.
Preserve important disagreements, decisions, open questions, options, and next steps.
Return the Markdown content only. Do not create, save, update, or link to any file yourself.
Do not mention provider memory, CLI brain folders, or local files outside this workspace.
ROOM will save your returned Markdown to .room/documents after you respond.

Output clean Markdown with these sections:
- Summary
- Key Ideas
- Decisions
- Open Questions
- Options Discussed
- Next Steps
- Useful Context for Future Chats

Chat transcript:
${transcript}`;

    const systemPrompt = `${summaryAgent.systemPrompt}

${LANGUAGE_POLICY}

${WORKSPACE_BOUNDARY_POLICY}

You are summarizing a collaborative ROOM chat into a compact memory artifact. Use the same natural language as the chat unless the user explicitly asked otherwise.`;

    const summary = stripExternalFileLinks(await provider.execute(prompt, systemPrompt), this.dirPath);
    const titleSource = discussionLog.topic || discussionLog.title || discussionId;
    const filename = `${this.safeDocumentSlug(titleSource)}-${discussionId}-summary.md`;
    const content = summary.trim().startsWith('#')
      ? summary.trim()
      : `# Chat Summary: ${titleSource}\n\n${summary.trim()}`;
    const documentsDir = path.join(this.dirPath, '.room', 'documents');
    await fs.mkdir(documentsDir, { recursive: true });
    await this.removeSupersededDiscussionSummaries(documentsDir, discussionId, filename);
    await fs.writeFile(path.join(documentsDir, filename), `${content}\n`, 'utf-8');
    await this.appendEvent({
      type: 'artifact.created',
      actor: summaryAgent.name,
      source: { type: 'discussion', id: discussionId },
      target: { type: 'artifact', id: filename },
      data: {
        path: path.join('.room', 'documents', filename),
        kind: 'summary'
      }
    });

    return { filename, content };
  }

  private async removeSupersededDiscussionSummaries(documentsDir: string, discussionId: string, keepFilename: string): Promise<void> {
    const suffix = `-${discussionId}-summary.md`;
    try {
      const files = await fs.readdir(documentsDir);
      await Promise.all(files
        .filter(file => file.endsWith(suffix) && file !== keepFilename)
        .map(file => fs.rm(path.join(documentsDir, file), { force: true })));
    } catch {
      // Summary cleanup is best-effort; failing it should not block saving the new artifact.
    }
  }

  async generateTasksFromDiscussion(
    discussionId: string,
    moderatorName?: string
  ): Promise<{ createdTaskCards: TaskCard[]; errors: string[] }> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const logPath = path.join(this.dirPath, '.room', 'discussions', `${discussionId}.json`);
    const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
    ensureStableMessageIds(discussionId, discussionLog.messages);
    const agents = await loadAgents(this.dirPath);
    const moderator = this.pickModerator(agents, moderatorName);
    if (!moderator) {
      throw new Error('No AI member is available to generate tasks.');
    }

    await this.assertAgentExecutionAllowed(moderator);
    const provider = this.getProvider(moderator);
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

    const content = stripExternalFileLinks(await provider.execute(prompt, systemPrompt), this.dirPath);
    const { actions, errors } = parseModeratorActions(content);
    const taskActions = actions.filter(action => action.action === 'create_task');
    if (taskActions.length === 0) {
      throw new Error('The moderator did not produce any create_task actions. Try again or pick another moderator.');
    }

    const executed = await executeModeratorActions(this.dirPath, taskActions, discussionId);
    await this.appendActionEvents(discussionId, executed);
    return { createdTaskCards: executed.createdTaskCards, errors: [...errors, ...executed.errors] };
  }

  async runDiscussion(
    discussionId: string,
    title: string,
    topic: string,
    agentNames: string[] = [],
    maxRounds = 3,
    options: DiscussionRunOptions = {}
  ): Promise<DiscussionLog> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const agents = await loadAgents(this.dirPath);
    const workflowAgents = agentNames
      .map(name => agents.find(a => a.name.toLowerCase() === name.toLowerCase()))
      .filter((a): a is AgentConfig => !!a);

    if (workflowAgents.length === 0) {
      throw new Error(`None of the requested AI members (${agentNames.join(', ') || 'none'}) were found in the workspace.`);
    }

    const discussionsDir = path.join(this.dirPath, '.room', 'discussions');
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
    const overview = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'overview.md'),
      path.join(this.dirPath, '.room', 'workspace.md'),
      path.join(this.dirPath, '.room', 'project.md')
    ]);
    const structure = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'structure.md'),
      path.join(this.dirPath, '.room', 'architecture', 'current.md')
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
    await this.appendMessageCreatedEvent('discussion', discussionId, userMessage);

    let approved = false;
    let successfulAgentRuns = 0;
    let failedAgentRuns = 0;
    const reviewerAgents = options.reviewMode
      ? workflowAgents.filter(agent => this.isReviewerAgent(agent))
      : [];

    for (let round = 1; round <= maxRounds; round++) {
      const roundReviewerApprovals = new Map<string, boolean>();

      for (const agent of workflowAgents) {
        console.log(`[Discussion Engine] Running Agent: ${agent.name} (Round ${round})...`);
        await this.assertAgentExecutionAllowed(agent);
        const provider = this.getProvider(agent);
        options.onEvent?.({
          type: 'agent_started',
          discussionId,
          agentName: agent.name,
          providerName: agent.provider,
          role: agent.role,
          round,
          timestamp: new Date().toLocaleTimeString()
        });
        let skillsContext = '';
        if (agent.skills && agent.skills.length > 0) {
          skillsContext = '\n\n=== Active Skills ===\n';
          for (const skillFile of agent.skills) {
            try {
              const resolvedSkillPath = await this.resolveSkillPath(skillFile);
              const skillContent = await fs.readFile(resolvedSkillPath, 'utf-8');
              skillsContext += `\n[Skill: ${skillFile}]\n${skillContent}\n`;
            } catch (err: any) {
              console.error(`Error loading skill ${skillFile}:`, err.message);
            }
          }
        }

        const compiledContext = await this.compileContextWithOptionalSummary(
          'discussion',
          discussionId,
          discussionLog.messages,
          projectContext,
          agents
        );
        const contextMessages = compiledContext.includedMessages;
        const priorMessageInstruction = compiledContext.priorMessageInstruction;
        const reviewProtocol = options.reviewMode ? this.buildReviewProtocol(agent) : '';
        // Only ask for reference tracing when there is prior history worth citing.
        // On the very first turn of a fresh discussion the only included message is
        // the current user prompt, so the room-refs block would always be empty.
        const hasReferableHistory = contextMessages.length > 1;
        const systemPrompt = composeAgentSystemPrompt(
          agent.systemPrompt,
          agent.provider === 'Local CLI',
          DISCUSSION_PROTOCOL,
          hasReferableHistory ? REFERENCE_TRACING_PROTOCOL : '',
          skillsContext,
          reviewProtocol,
          compiledContext.projectContextBlock
        );
        const prompt = `Here is the discussion history available for this response:\n${compiledContext.historyBlock}\n\nPlease provide your response as the ${agent.name} (${agent.role}).${priorMessageInstruction}${options.reviewMode ? '\n\nIf this is a later round, focus on closing remaining OPEN_FINDINGS before introducing new recommendations.' : ''}`;

        let response = '';
        let agentFailed = false;
        let messageReferences: MessageReference[] = [];
        try {
          response = await provider.execute(prompt, systemPrompt, {
            onChunk: (chunk) => {
              options.onEvent?.({
                type: 'agent_chunk',
                discussionId,
                agentName: agent.name,
                providerName: agent.provider,
                round,
                chunk: cleanAgentStreamChunk(chunk)
              });
            }
          });
          response = cleanAgentUserContent(stripExternalFileLinks(response, this.dirPath));
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
        } catch (err: any) {
          agentFailed = true;
          failedAgentRuns++;
          console.error(`Error executing agent ${agent.name}:`, err.message);
          options.onEvent?.({
            type: 'agent_error',
            discussionId,
            agentName: agent.name,
            providerName: agent.provider,
            round,
            error: err.message
          });
          response = cleanAgentUserContent(`[System Error from ${agent.name}]: Failed to execute provider ${agent.provider}. Details: ${err.message}`);
        }

        const msg: DiscussionMessage = {
          id: nextStableMessageId(discussionId, discussionLog.messages),
          type: 'agent',
          agentName: agent.name,
          providerName: agent.provider,
          content: response,
          timestamp: new Date().toLocaleTimeString(),
          contextMessages,
          ...(messageReferences.length > 0 ? { references: messageReferences } : {})
        };

        discussionLog.messages.push(msg);
        await this.appendMessageCreatedEvent('discussion', discussionId, msg);
        await this.appendReferenceEvents('discussion', discussionId, msg);
        options.onEvent?.({
          type: 'message_completed',
          discussionId,
          message: msg,
          round
        });

        await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
        await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');

        if (options.reviewMode && this.isReviewerAgent(agent)) {
          roundReviewerApprovals.set(agent.name, !agentFailed && this.isExplicitlyApproved(response));
        }
      }

      if (reviewerAgents.length > 0 && reviewerAgents.every(agent => roundReviewerApprovals.get(agent.name) === true)) {
        approved = true;
        console.log('[Discussion Engine] All reviewer agents approved the design. Workflow finished.');
        break;
      }
    }

    if (options.reviewMode) {
      discussionLog.status = successfulAgentRuns === 0 && failedAgentRuns > 0
        ? 'blocked'
        : (approved ? 'approved' : 'needs_revision');
    } else {
      discussionLog.status = successfulAgentRuns === 0 && failedAgentRuns > 0 ? 'blocked' : 'completed';
    }
    await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
    await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');
    options.onEvent?.({
      type: 'discussion_completed',
      discussionId,
      log: discussionLog
    });
    return discussionLog;
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
    if (!/^task-\d+$/.test(taskId)) {
      throw new Error('Invalid task id.');
    }

    const agents = await loadAgents(this.dirPath);
    const developer = agents.find(agent => agent.name.toLowerCase() === developerName.toLowerCase())
      || agents.find(agent => this.isDeveloperAgent(agent));
    if (!developer) {
      throw new Error('No Doer AI member is available for this task.');
    }

    const reviewers = reviewerNames
      .map(name => agents.find(agent => agent.name.toLowerCase() === name.toLowerCase()))
      .filter((agent): agent is AgentConfig => !!agent);
    const fallbackReviewer = agents.find(agent => this.isReviewerAgent(agent));
    if (reviewers.length === 0 && fallbackReviewer) {
      reviewers.push(fallbackReviewer);
    }
    if (reviewers.length === 0) {
      throw new Error('No Reviewer or Lead AI member is available for this task.');
    }

    const tasksDir = path.join(this.dirPath, '.room', 'tasks');
    const documentsDir = path.join(this.dirPath, '.room', 'documents');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(documentsDir, { recursive: true });
    const jsonFilename = `${taskId}.json`;
    const markdownFilename = `${taskId}.md`;
    const artifactFilename = `${taskId}-artifact.md`;
    const jsonPath = path.join(tasksDir, jsonFilename);
    const markdownPath = path.join(tasksDir, markdownFilename);
    const artifactPath = path.join(documentsDir, artifactFilename);

    const taskType = (options.taskType || 'general').trim().toLowerCase();
    const isCodingTask = taskType === 'coding';
    const doerLabel = isCodingTask ? 'Developer' : 'Doer';
    const reviewerLabel = isCodingTask ? 'Senior Developer or Reviewer' : 'Reviewer or Lead';
    const doerWorkInstructions = isCodingTask
      ? `- Work only inside the workspace root shown above.
- If your provider can edit files or run commands, implement the requested change now.
- If you cannot edit files directly, provide an exact patch-level implementation plan and say clearly that no files were changed.
- After working, report changed files, important decisions, validation commands run, and anything still blocked.`
      : `- Produce the requested work artifact now, not only a plan.
- Use the workspace context and selected references as source material.
- If the work should become a document, scene, research memo, decision note, checklist, or production plan, write it in clean Markdown.
- After working, report the artifact produced, decisions made, sources or context used, and anything still blocked.`;
    const reviewerRules = isCodingTask
      ? `- If your provider can inspect files or run commands, inspect the actual workspace before approving.
- Prioritize correctness, regressions, missing tests, unsafe filesystem behavior, and whether the task was actually implemented.
- If changes are needed, make them concrete enough for the Developer to fix in the next cycle.`
      : `- Review the actual artifact or deliverable, not just the intent.
- Prioritize usefulness, correctness, coherence, missing context, audience fit, and whether the task goal was actually satisfied.
- If changes are needed, make them concrete enough for the Doer to fix in the next cycle.`;

    let projectContext = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'overview.md'),
      path.join(this.dirPath, '.room', 'workspace.md'),
      path.join(this.dirPath, '.room', 'project.md')
    ]);
    const structure = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'structure.md'),
      path.join(this.dirPath, '.room', 'architecture', 'current.md')
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
        timestamp: new Date().toLocaleTimeString()
      }],
      markdownFilename,
      jsonFilename,
      artifactFilename,
      statusSummary: 'Task is queued.'
    };

    const saveResult = async () => {
      await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
      await fs.writeFile(markdownPath, renderCodingTaskMarkdown(result), 'utf-8');
    };

    options.onEvent?.({ type: 'discussion_started', discussionId: taskId, title });
    await saveResult();
    await this.appendMessageCreatedEvent('coding-task', taskId, result.messages[0]);

    let reviewerFeedback = '';
    const cycleLimit = Math.max(1, Math.min(5, Math.floor(maxCycles || 1)));
    for (let cycle = 1; cycle <= cycleLimit; cycle++) {
      result.cycles = cycle;
      await this.assertAgentExecutionAllowed(developer);
      const developerProvider = this.getProvider(developer);
      options.onEvent?.({
        type: 'agent_started',
        discussionId: taskId,
        agentName: developer.name,
        providerName: developer.provider,
        role: developer.role,
        round: cycle,
        timestamp: new Date().toLocaleTimeString()
      });

      const developerContext = await this.compileContextWithOptionalSummary(
        'coding-task',
        taskId,
        result.messages,
        projectContext,
        agents
      );
      const developerPrompt = `You are the ${doerLabel} assigned to this ROOM task.

Task type:
${taskType}

Task:
${task}

Workspace root:
${this.dirPath}

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

      let developerOutput = '';
      let developerReferences: MessageReference[] = [];
      try {
        developerOutput = await developerProvider.execute(developerPrompt, developerSystemPrompt, {
          onChunk: (chunk) => {
            options.onEvent?.({
              type: 'agent_chunk',
              discussionId: taskId,
              agentName: developer.name,
              providerName: developer.provider,
              round: cycle,
              chunk: cleanAgentStreamChunk(chunk)
            });
          }
        });
        developerOutput = cleanAgentUserContent(stripExternalFileLinks(developerOutput, this.dirPath));
        const parsedDeveloperRefs = parseMessageReferences(developerOutput, developerContext.includedMessages);
        developerReferences = parsedDeveloperRefs.references;
        if (parsedDeveloperRefs.cleaned) {
          developerOutput = parsedDeveloperRefs.cleaned;
        }
        if (developer.provider === 'Local CLI' && isOnlyOmissionNotes(developerOutput)) {
          developerOutput = localCliNoFinalAnswerMessage(developer.name);
        }
      } catch (err: any) {
        options.onEvent?.({
          type: 'agent_error',
          discussionId: taskId,
          agentName: developer.name,
          providerName: developer.provider,
          round: cycle,
          error: err.message
        });
        developerOutput = cleanAgentUserContent(`[System Error from ${developer.name}]: ${err.message}`);
      }

      const developerMessage: DiscussionMessage = {
        id: nextStableMessageId(taskId, result.messages),
        type: 'agent',
        agentName: developer.name,
        providerName: developer.provider,
        content: developerOutput,
        timestamp: new Date().toLocaleTimeString(),
        round: cycle,
        contextMessages: developerContext.includedMessages,
        ...(developerReferences.length > 0 ? { references: developerReferences } : {})
      };
      result.messages.push(developerMessage);
      await this.appendMessageCreatedEvent('coding-task', taskId, developerMessage);
      await this.appendReferenceEvents('coding-task', taskId, developerMessage);
      result.statusSummary = `${doerLabel} completed cycle ${cycle}. Waiting for review.`;
      options.onEvent?.({ type: 'message_completed', discussionId: taskId, message: developerMessage, round: cycle });
      await saveResult();

      const reviewerOutputs: string[] = [];
      for (const reviewer of reviewers) {
        await this.assertAgentExecutionAllowed(reviewer);
        const reviewerProvider = this.getProvider(reviewer);
        options.onEvent?.({
          type: 'agent_started',
          discussionId: taskId,
          agentName: reviewer.name,
          providerName: reviewer.provider,
          role: reviewer.role,
          round: cycle,
          timestamp: new Date().toLocaleTimeString()
        });

        const reviewerContext = await this.compileContextWithOptionalSummary(
          'coding-task',
          taskId,
          result.messages,
          projectContext,
          agents
        );
        const reviewPrompt = `Review this ROOM task after the ${doerLabel}'s latest pass.

Task type:
${taskType}

Task:
${task}

Workspace root:
${this.dirPath}

${reviewerContext.projectContextBlock || '=== Project Context ===\n(No workspace context provided.)'}

Task history available for this review:
${reviewerContext.historyBlock}

${doerLabel} report:
Use the latest ${doerLabel} message in the task history above.

Review rules:
${reviewerRules}
- Use APPROVAL_STATUS: APPROVED only when the task appears complete and no meaningful required change remains.
- Otherwise use APPROVAL_STATUS: NEEDS_CHANGES.

Output format:
- REVIEW_SUMMARY
- OPEN_FINDINGS
- REQUIRED_CHANGES
- VALIDATION_NOTES
- APPROVAL_STATUS: APPROVED | NEEDS_CHANGES`;

        const reviewerSystemPrompt = composeAgentSystemPrompt(
          reviewer.systemPrompt,
          reviewer.provider === 'Local CLI',
          `You are the ${reviewerLabel} in a ROOM task loop. Be strict, specific, and do not approve incomplete work.`,
          REFERENCE_TRACING_PROTOCOL
        );

        let reviewOutput = '';
        let reviewerReferences: MessageReference[] = [];
        try {
          reviewOutput = await reviewerProvider.execute(reviewPrompt, reviewerSystemPrompt, {
            onChunk: (chunk) => {
              options.onEvent?.({
                type: 'agent_chunk',
                discussionId: taskId,
                agentName: reviewer.name,
                providerName: reviewer.provider,
                round: cycle,
                chunk: cleanAgentStreamChunk(chunk)
              });
            }
          });
          reviewOutput = cleanAgentUserContent(stripExternalFileLinks(reviewOutput, this.dirPath));
          const parsedReviewerRefs = parseMessageReferences(reviewOutput, reviewerContext.includedMessages);
          reviewerReferences = parsedReviewerRefs.references;
          if (parsedReviewerRefs.cleaned) {
            reviewOutput = parsedReviewerRefs.cleaned;
          }
          if (reviewer.provider === 'Local CLI' && isOnlyOmissionNotes(reviewOutput)) {
            reviewOutput = localCliNoFinalAnswerMessage(reviewer.name);
          }
        } catch (err: any) {
          options.onEvent?.({
            type: 'agent_error',
            discussionId: taskId,
            agentName: reviewer.name,
            providerName: reviewer.provider,
            round: cycle,
            error: err.message
          });
          reviewOutput = cleanAgentUserContent(`[System Error from ${reviewer.name}]: ${err.message}`);
        }

        reviewerOutputs.push(reviewOutput);
        const reviewerMessage: DiscussionMessage = {
          id: nextStableMessageId(taskId, result.messages),
          type: 'agent',
          agentName: reviewer.name,
          providerName: reviewer.provider,
          content: reviewOutput,
          timestamp: new Date().toLocaleTimeString(),
          round: cycle,
          contextMessages: reviewerContext.includedMessages,
          ...(reviewerReferences.length > 0 ? { references: reviewerReferences } : {})
        };
        result.messages.push(reviewerMessage);
        await this.appendMessageCreatedEvent('coding-task', taskId, reviewerMessage);
        await this.appendReferenceEvents('coding-task', taskId, reviewerMessage);
        options.onEvent?.({ type: 'message_completed', discussionId: taskId, message: reviewerMessage, round: cycle });
        await saveResult();
      }

      if (this.parseCodingApproval(reviewerOutputs)) {
        result.status = 'approved';
        result.approvedBy = reviewers.map(reviewer => reviewer.name);
        result.statusSummary = `Approved after ${cycle} cycle(s).\n${this.extractTaskReviewSummary(reviewerOutputs)}`;
        await saveResult();
        break;
      }

      reviewerFeedback = reviewerOutputs.join('\n\n---\n\n');
      result.statusSummary = `Needs revision after cycle ${cycle}.\n${this.extractTaskReviewSummary(reviewerOutputs)}`;
    }

    if (result.status !== 'approved' && result.cycles >= cycleLimit) {
      result.status = 'needs_revision';
      if (!result.statusSummary || result.statusSummary === 'Task is queued.') {
        result.statusSummary = `Stopped after ${result.cycles} cycle(s) without approval.`;
      }
    }

    const finalDoerMessage = [...result.messages]
      .reverse()
      .find(message => message.type === 'agent' && message.agentName === developer.name) || null;
    await fs.writeFile(artifactPath, renderTaskArtifact(result, finalDoerMessage), 'utf-8');
    await this.appendEvent({
      type: 'artifact.created',
      source: { type: 'coding-task', id: taskId },
      target: { type: 'artifact', id: artifactFilename },
      data: {
        path: path.join('.room', 'tasks', artifactFilename),
        sourceMessageId: finalDoerMessage?.id
      }
    });
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
}
