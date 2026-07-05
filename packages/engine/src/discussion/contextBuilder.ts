import * as fs from 'fs/promises';
import * as path from 'path';
import { loadAgents, type AgentConfig } from '../agents/registry.js';
import { Provider } from '../providers/provider.js';
import type { NewRoomEvent } from '../events/eventLog.js';
import {
  compileDiscussionContext,
  type CompiledDiscussionContext,
  type PromptHistoryMessage
} from './contextCompiler.js';
import {
  readContextSummaryCache,
  writeContextSummaryCache,
  createContextSummaryCache,
  checkContextSummaryCacheReuse,
  type ContextSummarySource
} from './contextSummaryCache.js';
import {
  MAX_UNSUMMARIZED_OMITTED_MESSAGES,
  summarizeContextMessages,
  shouldGenerateContextSummary,
  updateContextSummary,
  DEFAULT_CONTEXT_SUMMARY_POLICY
} from './contextSummarizer.js';
import { trimTextToTokenBudget } from './tokenBudget.js';
import { parseSkillFrontmatter } from '../skills/parser.js';
import {
  composeAgentSystemPrompt,
  ensureStableMessageIds,
  stripExternalFileLinks,
  safeDocumentSlug,
  LANGUAGE_POLICY,
  WORKSPACE_BOUNDARY_POLICY
} from './utils.js';
import type { DiscussionLog } from './types.js';

export function globToRegex(pattern: string): RegExp {
  let result = pattern.trim();
  result = result.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  result = result.replace(/\*\*\//g, '<<<GLOBSTAR_SLASH>>>');
  result = result.replace(/\*\*/g, '<<<GLOBSTAR>>>');
  result = result.replace(/\*/g, '[^/]*');
  result = result.replace(/<<<GLOBSTAR_SLASH>>>/g, '(.*/)?');
  result = result.replace(/<<<GLOBSTAR>>>/g, '.*');
  return new RegExp(`^${result}$`, 'i');
}

export function pickContextSummaryAgent(agents: AgentConfig[]): AgentConfig | undefined {
  const nonLocalAgents = agents.filter(agent => agent.provider !== 'Local CLI');
  return nonLocalAgents.find(agent => {
    const text = `${agent.name} ${agent.role}`.toLowerCase();
    return text.includes('reporter') || text.includes('scribe') || text.includes('summary');
  }) || nonLocalAgents[0];
}

export interface ContextSummaryEvent {
  type: 'context_summary_generated' | 'context_summary_reused' | 'context_summary_failed';
  contextId: string;
  candidateCount: number;
  error?: string;
}

export async function compileContextWithOptionalSummary(
  dirPath: string,
  source: ContextSummarySource,
  contextId: string,
  messages: PromptHistoryMessage[],
  projectContext: string,
  agents: AgentConfig[],
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  onSummaryEvent?: (event: ContextSummaryEvent) => void
): Promise<CompiledDiscussionContext> {
  const draftContext = compileDiscussionContext(messages, projectContext);
  const candidateIndexes = draftContext.summaryCandidateIndexes;
  if (candidateIndexes.length === 0) {
    return draftContext;
  }

  const emit = (type: ContextSummaryEvent['type'], error?: string) => {
    onSummaryEvent?.({ type, contextId, candidateCount: candidateIndexes.length, ...(error ? { error } : {}) });
  };

  const cacheInput = { dirPath, source, contextId };
  const existingCache = await readContextSummaryCache(cacheInput);
  const reuse = checkContextSummaryCacheReuse(existingCache, messages, candidateIndexes);

  if (reuse.exact) {
    emit('context_summary_reused');
    return compileDiscussionContext(messages, projectContext, {
      summary: existingCache!.summary
    });
  }

  if (reuse.prefix && reuse.uncoveredIndexes.length <= MAX_UNSUMMARIZED_OMITTED_MESSAGES) {
    emit('context_summary_reused');
    const summary = `${existingCache!.summary}\n\n[Plus ${reuse.uncoveredIndexes.length} newer omitted message(s) not yet folded into this summary.]`;
    return compileDiscussionContext(messages, projectContext, { summary });
  }

  if (!reuse.prefix && !shouldGenerateContextSummary(messages, candidateIndexes)) {
    return draftContext;
  }

  const summaryAgent = pickContextSummaryAgent(agents);
  if (!summaryAgent) {
    emit('context_summary_failed', 'No eligible (non-Local CLI) summary agent available.');
    return draftContext;
  }

  try {
    await assertAgentExecutionAllowed(summaryAgent);
    const provider = getProvider(summaryAgent);
    const systemPrompt = composeAgentSystemPrompt(
      summaryAgent.systemPrompt,
      false,
      'You summarize omitted ROOM context into compact durable memory for future agent turns.'
    );
    const summary = reuse.prefix
      ? await updateContextSummary(provider, systemPrompt, existingCache!.summary, messages, reuse.uncoveredIndexes, DEFAULT_CONTEXT_SUMMARY_POLICY)
      : await summarizeContextMessages(provider, systemPrompt, messages, candidateIndexes, DEFAULT_CONTEXT_SUMMARY_POLICY);
    const cache = createContextSummaryCache(source, contextId, messages, candidateIndexes, summary);
    await writeContextSummaryCache(cacheInput, cache);
    emit('context_summary_generated');
    return compileDiscussionContext(messages, projectContext, { summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Discussion Engine] Skipped context summary cache for ${contextId}: ${message}`);
    emit('context_summary_failed', message);
    return draftContext;
  }
}

export function buildBudgetedTranscript(log: DiscussionLog, maxHistoryTokens = 20000, omittedSummary = ''): string {
  const compiled = compileDiscussionContext(log.messages, '', {
    maxHistoryTokens,
    maxMessageTokens: Math.min(3500, maxHistoryTokens),
    summary: omittedSummary
  });
  return `# ${log.title}\n\n## Current Topic\n${log.topic || 'Untitled'}\n\n## Status\n${log.status}\n\n## Transcript\n${compiled.historyBlock}`;
}

export async function buildBudgetedTranscriptWithCache(
  dirPath: string,
  source: ContextSummarySource,
  contextId: string,
  log: DiscussionLog,
  maxHistoryTokens = 20000
): Promise<string> {
  const cache = await readContextSummaryCache({ dirPath, source, contextId });
  return buildBudgetedTranscript(log, maxHistoryTokens, cache?.summary);
}

export function composeProjectContext(input: {
  overview?: string;
  structure?: string;
  additionalContext?: string;
  workspaceMemory?: string;
}): string {
  const sections: string[] = [];
  if (input.additionalContext?.trim()) {
    sections.push(`Selected Context:\n${input.additionalContext.trim()}`);
  }
  if (input.overview?.trim()) {
    sections.push(input.overview.trim());
  }
  if (input.workspaceMemory?.trim()) {
    sections.push(input.workspaceMemory.trim());
  }
  if (input.structure?.trim()) {
    sections.push(`Workspace Structure:\n${input.structure.trim()}`);
  }
  return sections.join('\n\n');
}

export async function loadWorkspaceMemoryContext(
  dirPath: string,
  maxTokens = 2500,
  excludeId?: string
): Promise<string> {
  const sections: string[] = [];

  const adrs = await listMarkdownByMtime(
    path.join(dirPath, '.room', 'decisions'),
    file => /^ADR-/i.test(file),
    3
  );
  for (const adr of adrs) {
    sections.push(`[Decision: ${adr.name}]\n${adr.content.trim()}`);
  }

  const summaries = await listMarkdownByMtime(
    path.join(dirPath, '.room', 'documents'),
    file => file.endsWith('-summary.md') && (!excludeId || !file.includes(excludeId)),
    2
  );
  for (const doc of summaries) {
    sections.push(`[Past Discussion Summary: ${doc.name}]\n${doc.content.trim()}`);
  }

  if (sections.length === 0) return '';
  const fitted = trimTextToTokenBudget(sections.join('\n\n'), maxTokens);
  return `Workspace Memory (recent decisions and past discussion summaries):\n${fitted.text}${fitted.truncated ? '\n\n[Workspace memory trimmed to fit the prompt budget.]' : ''}`;
}

export async function buildSkillsContext(
  dirPath: string,
  skillFiles: string[],
  maxTokensPerSkill = 1500
): Promise<string> {
  const sections: string[] = [];
  for (const skillFile of skillFiles) {
    try {
      const resolvedSkillPath = await resolveSkillPath(dirPath, skillFile);
      const skillContent = await fs.readFile(resolvedSkillPath, 'utf-8');
      const parsed = parseSkillFrontmatter(skillContent);
      const fitted = trimTextToTokenBudget(parsed.content.trim(), maxTokensPerSkill);
      const body = `${fitted.text}${fitted.truncated ? '\n\n[Skill content trimmed to fit the prompt budget.]' : ''}`;
      sections.push(`[Skill: ${skillFile}]\n${body}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error loading skill ${skillFile}:`, message);
    }
  }
  if (sections.length === 0) return '';
  return `\n\n=== Active Skills ===\n\n${sections.join('\n\n')}\n`;
}

async function listMarkdownByMtime(
  dir: string,
  match: (file: string) => boolean,
  limit: number
): Promise<{ name: string; content: string }[]> {
  try {
    const files = (await fs.readdir(dir)).filter(file => file.toLowerCase().endsWith('.md') && match(file));
    const stats = await Promise.all(files.map(async name => ({
      name,
      mtimeMs: (await fs.stat(path.join(dir, name))).mtimeMs
    })));
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return Promise.all(stats.slice(0, limit).map(async ({ name }) => ({
      name,
      content: await fs.readFile(path.join(dir, name), 'utf-8')
    })));
  } catch {
    return [];
  }
}

export async function readFirstExistingFile(paths: string[]): Promise<string> {
  for (const filePath of paths) {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {}
  }
  return '';
}

export async function autoMatchSkills(
  dirPath: string,
  mentionedFilePaths: string[],
  discussionText: string
): Promise<string[]> {
  const skillsDir = path.resolve(dirPath, '.room', 'skills');
  const matchedSkillFiles: string[] = [];

  try {
    const files = await fs.readdir(skillsDir);
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.md')) {
        continue;
      }

      try {
        const resolvedPath = path.resolve(skillsDir, file);
        const rawContent = await fs.readFile(resolvedPath, 'utf-8');
        const { metadata } = parseSkillFrontmatter(rawContent);

        if (metadata.alwaysApply) {
          matchedSkillFiles.push(file);
          continue;
        }

        let matchesGlob = false;
        if (metadata.globs && metadata.globs.length > 0 && mentionedFilePaths.length > 0) {
          for (const pattern of metadata.globs) {
            const regex = globToRegex(pattern);
            for (const filePath of mentionedFilePaths) {
              if (regex.test(filePath)) {
                matchesGlob = true;
                break;
              }
            }
            if (matchesGlob) break;
          }
        }

        let matchesKeyword = false;
        if (metadata.triggerKeywords && metadata.triggerKeywords.length > 0 && discussionText) {
          const normalizedText = discussionText.toLowerCase();
          for (const keyword of metadata.triggerKeywords) {
            if (normalizedText.includes(keyword.toLowerCase())) {
              matchesKeyword = true;
              break;
            }
          }
        }

        if (matchesGlob || matchesKeyword) {
          matchedSkillFiles.push(file);
        }
      } catch (err: any) {
        console.error(`Error auto-matching skill file ${file}:`, err.message);
      }
    }
  } catch {}

  return matchedSkillFiles;
}

export async function resolveSkillPath(dirPath: string, skillFile: string): Promise<string> {
  const trimmedSkillFile = (skillFile || '').trim();
  if (/[\\/]/.test(trimmedSkillFile)) {
    throw new Error(`Unsafe skill filename: ${skillFile}`);
  }

  const safeName = path.basename(trimmedSkillFile);
  if (!safeName || !safeName.toLowerCase().endsWith('.md')) {
    throw new Error(`Unsafe or unsupported skill filename: ${skillFile}`);
  }

  const dirs = [
    path.resolve(dirPath, '.room', 'skills'),
    path.resolve(dirPath, '.room', 'roles')
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

export function isReviewerAgent(agent: AgentConfig): boolean {
  const name = agent.name.toLowerCase();
  const role = agent.role.toLowerCase();
  return name.includes('reviewer') || role.includes('review') || role.includes('audit');
}

export function buildReviewProtocol(agent: AgentConfig): string {
  if (isReviewerAgent(agent)) {
    return `

=== Review Loop Protocol ===
You are responsible for finding and tracking implementation gaps.
Respond with these sections:
- OPEN_FINDINGS: unresolved blocker/major/minor findings, each with concrete rationale.
- RESOLVED_FINDINGS: findings from prior rounds that are now closed.
- REQUIRED_CHANGES: specific changes needed before approval.
- VALIDATION_NOTES: details of testing or verification performed.
- APPROVAL_STATUS: either "NEEDS_REVISION" or "APPROVED".

To approve, you MUST satisfy:
1. All prior OPEN_FINDINGS are resolved.
2. The code changes actually implement the task successfully.
3. If no further changes are needed, you must set:
   APPROVAL_STATUS: APPROVED
   OPEN_FINDINGS: None.`;
  }
  return '';
}

export async function summarizeDiscussionLoop(
  dirPath: string,
  discussionId: string,
  agentNames: string[] = [],
  summaryAgentOverride: AgentConfig | undefined,
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  appendEvent: (input: NewRoomEvent) => Promise<void>
): Promise<{ filename: string; content: string }> {
  if (!/^discussion-[\w-]+$/.test(discussionId)) {
    throw new Error('Invalid discussion id.');
  }

  const logPath = path.join(dirPath, '.room', 'discussions', `${discussionId}.json`);
  const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
  ensureStableMessageIds(discussionId, discussionLog.messages);
  const agents = await loadAgents(dirPath);
  const summaryAgent = summaryAgentOverride || agentNames
    .map(name => agents.find((a: AgentConfig) => a.name.toLowerCase() === name.toLowerCase()))
    .find((agent): agent is AgentConfig => !!agent) || agents.find((agent: AgentConfig) => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return text.includes('reporter') || text.includes('scribe') || text.includes('summary');
    }) || agents[0];

  if (!summaryAgent) {
    throw new Error('No AI member is available to summarize this chat.');
  }

  await assertAgentExecutionAllowed(summaryAgent);
  const provider = getProvider(summaryAgent);
  const transcript = await buildBudgetedTranscriptWithCache(dirPath, 'discussion', discussionId, discussionLog);
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

  const summary = stripExternalFileLinks(await provider.execute(prompt, systemPrompt), dirPath);
  const titleSource = discussionLog.topic || discussionLog.title || discussionId;
  const filename = `${safeDocumentSlug(titleSource)}-${discussionId}-summary.md`;
  const content = summary.trim().startsWith('#')
    ? summary.trim()
    : `# Chat Summary: ${titleSource}\n\n${summary.trim()}`;
  const documentsDir = path.join(dirPath, '.room', 'documents');
  await fs.mkdir(documentsDir, { recursive: true });
  await removeSupersededDiscussionSummaries(documentsDir, discussionId, filename);
  await fs.writeFile(path.join(documentsDir, filename), `${content}\n`, 'utf-8');
  await appendEvent({
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

async function removeSupersededDiscussionSummaries(documentsDir: string, discussionId: string, keepFilename: string): Promise<void> {
  const suffix = `-${discussionId}-summary.md`;
  try {
    const files = await fs.readdir(documentsDir);
    await Promise.all(files
      .filter(file => file.endsWith(suffix) && file !== keepFilename)
      .map(file => fs.rm(path.join(documentsDir, file), { force: true })));
  } catch {
    // Summary cleanup is best-effort
  }
}
