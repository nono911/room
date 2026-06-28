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
  isReusableContextSummaryCache,
  type ContextSummarySource
} from './contextSummaryCache.js';
import {
  summarizeContextMessages,
  shouldGenerateContextSummary,
  DEFAULT_CONTEXT_SUMMARY_POLICY
} from './contextSummarizer.js';
import { parseSkillFrontmatter } from '../skills/parser.js';
import {
  composeAgentSystemPrompt,
  ensureStableMessageIds,
  renderDiscussionMarkdown,
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

export async function compileContextWithOptionalSummary(
  dirPath: string,
  source: ContextSummarySource,
  contextId: string,
  messages: PromptHistoryMessage[],
  projectContext: string,
  agents: AgentConfig[],
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>
): Promise<CompiledDiscussionContext> {
  const draftContext = compileDiscussionContext(messages, projectContext);
  const candidateIndexes = draftContext.summaryCandidateIndexes;
  if (candidateIndexes.length === 0) {
    return draftContext;
  }

  const cacheInput = { dirPath, source, contextId };
  const existingCache = await readContextSummaryCache(cacheInput);
  if (isReusableContextSummaryCache(existingCache, messages, candidateIndexes)) {
    return compileDiscussionContext(messages, projectContext, {
      summary: existingCache.summary
    });
  }

  if (!shouldGenerateContextSummary(messages, candidateIndexes)) {
    return draftContext;
  }

  const summaryAgent = pickContextSummaryAgent(agents);
  if (!summaryAgent) {
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
