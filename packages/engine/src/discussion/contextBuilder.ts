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
  isMachineSkillReference,
  approvedMachineSkillContent,
  normalizeMachineSkillReference,
  readMachineSkill,
  type ApprovedMachineSkillSnapshot,
  type MachineSkillCatalogOptions
} from '../skills/machineCatalog.js';
import { parseRoomSkillReference } from '../skills/roomSkillReference.js';
import {
  composeAgentSystemPrompt,
  ensureStableMessageIds,
  stripExternalFileLinks,
  safeDocumentSlug,
  LANGUAGE_POLICY,
  WORKSPACE_BOUNDARY_POLICY
} from './utils.js';
import type { DiscussionLog } from './types.js';
import {
  readRoomTextFile,
  withRoomStorageReconciliation,
  writeRoomTextFile
} from '../roomFile.js';
import {
  listDirectoryNamesBounded
} from '../boundedFs.js';
import {
  MAX_RUN_ARTIFACT_BYTES,
  assertBoundedRunArtifact
} from './runArtifact.js';
import { listMarkdownByMtime } from './roomMemoryReader.js';
import {
  resolveRoomPath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from '../workspace.js';
import { readRoomSkill } from './roomSkillReader.js';
import {
  roomSkillSnapshotContent,
  autoMatchedRoomSkillReferences,
  type RoomSkillSnapshot
} from './roomSkillSnapshot.js';
import { isDiscussionRunId } from './runId.js';
export { autoMatchSkills } from './autoMatchSkills.js';

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
  workspace: WorkspaceInput,
  source: ContextSummarySource,
  contextId: string,
  messages: PromptHistoryMessage[],
  projectContext: string,
  agents: AgentConfig[],
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  onSummaryEvent?: (event: ContextSummaryEvent) => void,
  approvedMachineSkills: readonly ApprovedMachineSkillSnapshot[] = [],
  roomSkillSnapshots?: readonly RoomSkillSnapshot[]
): Promise<CompiledDiscussionContext> {
  const draftContext = compileDiscussionContext(messages, projectContext);
  const candidateIndexes = draftContext.summaryCandidateIndexes;
  if (candidateIndexes.length === 0) {
    return draftContext;
  }

  const emit = (type: ContextSummaryEvent['type'], error?: string) => {
    onSummaryEvent?.({ type, contextId, candidateCount: candidateIndexes.length, ...(error ? { error } : {}) });
  };

  const cacheInput = { workspace, source, contextId };
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
    const skillsContext = await buildSkillsContext(
      workspace,
      Array.from(new Set([
        ...(summaryAgent.skills || []),
        ...autoMatchedRoomSkillReferences(roomSkillSnapshots || [])
      ])),
      1500,
      undefined,
      approvedMachineSkills,
      summaryAgent,
      roomSkillSnapshots
    );
    const systemPrompt = composeAgentSystemPrompt(
      summaryAgent.systemPrompt,
      false,
      'You summarize omitted ROOM context into compact durable memory for future agent turns.',
      skillsContext
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
  workspace: WorkspaceInput,
  source: ContextSummarySource,
  contextId: string,
  log: DiscussionLog,
  maxHistoryTokens = 20000
): Promise<string> {
  const cache = await readContextSummaryCache({ workspace, source, contextId });
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
    sections.push(`Room Structure:\n${input.structure.trim()}`);
  }
  return sections.join('\n\n');
}

export async function loadWorkspaceMemoryContext(
  workspace: WorkspaceInput,
  maxTokens = 2500,
  excludeId?: string
): Promise<string> {
  const sections: string[] = [];

  const adrs = await listMarkdownByMtime(
    workspace,
    'decisions',
    file => /^ADR-/i.test(file),
    3
  );
  for (const adr of adrs) {
    sections.push(`[Decision: ${adr.name}]\n${adr.content.trim()}`);
  }

  const summaries = await listMarkdownByMtime(
    workspace,
    'documents',
    file => file.endsWith('-summary.md') && (!excludeId || !file.includes(excludeId)),
    2
  );
  for (const doc of summaries) {
    sections.push(`[Past Discussion Summary: ${doc.name}]\n${doc.content.trim()}`);
  }

  if (sections.length === 0) return '';
  const fitted = trimTextToTokenBudget(sections.join('\n\n'), maxTokens);
  return `Room Memory (recent decisions and past discussion summaries):\n${fitted.text}${fitted.truncated ? '\n\n[Room memory trimmed to fit the prompt budget.]' : ''}`;
}

export async function buildSkillsContext(
  workspace: WorkspaceInput,
  skillFiles: string[],
  maxTokensPerSkill = 1500,
  machineCatalogOptions?: MachineSkillCatalogOptions,
  approvedMachineSkills: readonly ApprovedMachineSkillSnapshot[] = [],
  executingAgent?: Pick<AgentConfig, 'id' | 'provider'>,
  roomSkillSnapshots?: readonly RoomSkillSnapshot[]
): Promise<string> {
  void machineCatalogOptions;
  const sections: string[] = [];
  for (const skillFile of skillFiles) {
    try {
      const machineReference = isMachineSkillReference(skillFile)
        ? normalizeMachineSkillReference(skillFile)
        : null;
      const skillContent = machineReference
        ? approvedMachineSkillContent(
            approvedMachineSkills,
            executingAgent,
            machineReference
          )
          ?? (() => { throw new Error(`Machine skill requires a member-bound approved snapshot: ${skillFile}`); })()
        : roomSkillSnapshots === undefined
          ? await readRoomSkill(workspace, skillFile)
          : roomSkillSnapshotContent(roomSkillSnapshots, skillFile)
            ?? (() => { throw new Error(`Room skill is unavailable in the run snapshot: ${skillFile}`); })();
      const parsed = parseSkillFrontmatter(skillContent);
      const fitted = trimTextToTokenBudget(parsed.content.trim(), maxTokensPerSkill);
      const body = `${fitted.text}${fitted.truncated ? '\n\n[Skill content trimmed to fit the prompt budget.]' : ''}`;
      sections.push(`[Skill: ${skillFile}]\n${body}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error loading skill ${skillFile}:`, message);
      if (isMachineSkillReference(skillFile)) throw err;
    }
  }
  if (sections.length === 0) return '';
  return `\n\n=== Active Skills ===\n\n${sections.join('\n\n')}\n`;
}

export async function resolveSkillPath(workspace: WorkspaceInput, skillFile: string): Promise<string> {
  const trimmedSkillFile = (skillFile || '').trim();
  if (isMachineSkillReference(trimmedSkillFile)) {
    return (await readMachineSkill(trimmedSkillFile)).filePath;
  }
  const parsed = parseRoomSkillReference(trimmedSkillFile);
  if (!parsed) throw new Error(`Unsafe Room skill reference: ${skillFile}`);
  return resolveRoomPath(workspace, parsed.source, parsed.filename);
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
  workspace: WorkspaceInput,
  discussionId: string,
  agentNames: string[] = [],
  summaryAgentOverride: AgentConfig | undefined,
  approvedMachineSkills: readonly ApprovedMachineSkillSnapshot[],
  roomSkillSnapshots: readonly RoomSkillSnapshot[],
  getProvider: (agent: AgentConfig) => Provider,
  assertAgentExecutionAllowed: (agent: AgentConfig) => Promise<void>,
  appendEvent: (input: NewRoomEvent) => Promise<void>
): Promise<{ filename: string; content: string }> {
  if (!isDiscussionRunId(discussionId)) {
    throw new Error('Invalid discussion id.');
  }

  const discussionLog = JSON.parse(await readRoomTextFile(
    workspace,
    ['discussions', `${discussionId}.json`],
    MAX_RUN_ARTIFACT_BYTES
  )) as DiscussionLog;
  ensureStableMessageIds(discussionId, discussionLog.messages);
  const agents = await loadAgents(workspace);
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
  const transcript = await buildBudgetedTranscriptWithCache(workspace, 'discussion', discussionId, discussionLog);
  const prompt = `Summarize this ROOM chat into a durable workspace memory document.

Focus on the useful state that should survive after the raw chat becomes too long.
Do not merely restate every message.
Preserve important disagreements, decisions, open questions, options, and next steps.
Return the Markdown content only. Do not create, save, update, or link to any file yourself.
Do not mention provider memory, CLI brain folders, or local files outside this workspace.
ROOM will save your returned Markdown to its managed workspace documents store after you respond.

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

  const skillsContext = await buildSkillsContext(
    workspace,
    Array.from(new Set([
      ...(summaryAgent.skills || []),
      ...autoMatchedRoomSkillReferences(roomSkillSnapshots)
    ])),
    1500,
    undefined,
    approvedMachineSkills,
    summaryAgent,
    roomSkillSnapshots
  );
  const systemPrompt = composeAgentSystemPrompt(
    summaryAgent.systemPrompt,
    summaryAgent.provider === 'Local CLI',
    'You are summarizing a collaborative ROOM chat into a compact memory artifact. Use the same natural language as the chat unless the user explicitly asked otherwise.',
    skillsContext
  );

  const sourceRoot = resolveWorkspaceLocation(workspace).sourceRoot
    || resolveWorkspaceLocation(workspace).roomRoot;
  const summary = stripExternalFileLinks(await provider.execute(prompt, systemPrompt), sourceRoot);
  const titleSource = discussionLog.topic || discussionLog.title || discussionId;
  const filename = `${safeDocumentSlug(titleSource)}-${discussionId}-summary.md`;
  const content = summary.trim().startsWith('#')
    ? summary.trim()
    : `# Chat Summary: ${titleSource}\n\n${summary.trim()}`;
  const documentsDir = resolveRoomPath(workspace, 'documents');
  await fs.mkdir(documentsDir, { recursive: true });
  await withRoomStorageReconciliation(
    workspace,
    () => removeSupersededDiscussionSummaries(documentsDir, discussionId, filename)
  );
  await writeRoomTextFile(
    workspace,
    ['documents', filename],
    assertBoundedRunArtifact(`${content}\n`, 'Discussion summary')
  );
  await appendEvent({
    type: 'artifact.created',
    actor: summaryAgent.name,
    source: { type: 'discussion', id: discussionId },
    target: { type: 'artifact', id: filename },
    data: {
      path: path.join('documents', filename),
      kind: 'summary'
    }
  });

  return { filename, content };
}

async function removeSupersededDiscussionSummaries(documentsDir: string, discussionId: string, keepFilename: string): Promise<void> {
  const suffix = `-${discussionId}-summary.md`;
  try {
    const files = (await listDirectoryNamesBounded(documentsDir, 1_000)).names;
    await Promise.all(files
      .filter(file => file.endsWith(suffix) && file !== keepFilename)
      .map(file => fs.rm(path.join(documentsDir, file), { force: true })));
  } catch {
    // Summary cleanup is best-effort
  }
}
