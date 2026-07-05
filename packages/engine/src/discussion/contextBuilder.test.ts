import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentConfig } from '../agents/registry.js';
import type { Provider } from '../providers/provider.js';
import {
  buildBudgetedTranscript,
  buildSkillsContext,
  compileContextWithOptionalSummary,
  composeProjectContext,
  loadWorkspaceMemoryContext,
  type ContextSummaryEvent
} from './contextBuilder.js';
import { compileDiscussionContext } from './contextCompiler.js';
import { estimateTokenCount } from './tokenBudget.js';
import type { DiscussionLog } from './types.js';

function bigLog(messageCount: number, charsPerMessage: number): DiscussionLog {
  return {
    id: 'discussion-1',
    title: 'Big discussion',
    topic: 'Budget test',
    status: 'active',
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `discussion-1:message-${String(index + 1).padStart(4, '0')}`,
      type: index === 0 ? 'user' as const : 'agent' as const,
      agentName: index === 0 ? 'You' : `Agent ${index}`,
      providerName: index === 0 ? 'User' : 'Claude',
      content: `msg${index} ${'x'.repeat(charsPerMessage)}`,
      timestamp: '10:00'
    }))
  };
}

function longMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `discussion-123:message-${String(index + 1).padStart(4, '0')}`,
    type: index === 0 ? 'user' as const : 'agent' as const,
    agentName: index === 0 ? 'You' : `Agent ${index}`,
    providerName: index === 0 ? 'User' : 'Claude',
    content: `msg${index} ${'x'.repeat(6000)}`,
    timestamp: '10:00'
  }));
}

const summaryAgent: AgentConfig = {
  name: 'Reporter',
  role: 'Summary Reporter',
  provider: 'Claude',
  systemPrompt: 'You are a reporter.'
};

describe('buildBudgetedTranscript', () => {
  it('keeps huge transcripts within the token budget', () => {
    const transcript = buildBudgetedTranscript(bigLog(60, 4000), 8000);
    expect(estimateTokenCount(transcript)).toBeLessThanOrEqual(9000);
    expect(transcript).toContain('older message(s) are omitted');
  });

  it('always contains the title, topic, and latest message', () => {
    const transcript = buildBudgetedTranscript(bigLog(60, 4000), 8000);
    expect(transcript).toContain('Big discussion');
    expect(transcript).toContain('Budget test');
    expect(transcript).toContain('msg59');
  });

  it('includes everything when the log is small', () => {
    const transcript = buildBudgetedTranscript(bigLog(3, 100));
    expect(transcript).toContain('All messages are included');
    expect(transcript).toContain('msg1');
  });

  it('includes the cached omitted-message summary when provided', () => {
    const transcript = buildBudgetedTranscript(bigLog(60, 4000), 8000, 'Earlier decision: use SQLite.');
    expect(transcript).toContain('=== Summary of Omitted Messages ===');
    expect(transcript).toContain('Earlier decision: use SQLite.');
  });
});

describe('compileContextWithOptionalSummary', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-ctx-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('emits context_summary_failed and falls back when the provider throws', async () => {
    const events: ContextSummaryEvent[] = [];
    const failingProvider = { execute: async () => { throw new Error('provider down'); } } as unknown as Provider;
    const compiled = await compileContextWithOptionalSummary(
      tmpDir, 'discussion', 'discussion-123', longMessages(14), '', [summaryAgent],
      () => failingProvider, async () => {}, event => events.push(event)
    );
    expect(compiled.summaryUsed).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({ type: 'context_summary_failed', contextId: 'discussion-123', error: 'provider down' })
    ]);
  });

  it('generates, caches, and then reuses a summary', async () => {
    const events: ContextSummaryEvent[] = [];
    let calls = 0;
    const provider = { execute: async () => { calls++; return 'compact summary of older messages'; } } as unknown as Provider;
    const messages = longMessages(14);
    const run = () => compileContextWithOptionalSummary(
      tmpDir, 'discussion', 'discussion-123', messages, '', [summaryAgent],
      () => provider, async () => {}, event => events.push(event)
    );

    const first = await run();
    expect(first.summaryUsed).toBe(true);
    expect(first.historyBlock).toContain('compact summary of older messages');
    expect(events[0].type).toBe('context_summary_generated');

    const second = await run();
    expect(second.summaryUsed).toBe(true);
    expect(calls).toBe(1);
    expect(events[1].type).toBe('context_summary_reused');
  });

  it('emits context_summary_failed when no eligible summary agent exists', async () => {
    const events: ContextSummaryEvent[] = [];
    const localAgent: AgentConfig = { ...summaryAgent, provider: 'Local CLI' };
    const compiled = await compileContextWithOptionalSummary(
      tmpDir, 'discussion', 'discussion-123', longMessages(14), '', [localAgent],
      () => ({ execute: async () => 'unused' } as unknown as Provider), async () => {}, event => events.push(event)
    );
    expect(compiled.summaryUsed).toBe(false);
    expect(events[0]).toEqual(expect.objectContaining({ type: 'context_summary_failed' }));
  });

  it('reuses a prefix cache with a note instead of calling the provider', async () => {
    let calls = 0;
    const provider = { execute: async () => { calls++; return 'base summary'; } } as unknown as Provider;
    const messages = longMessages(14);
    const run = (msgs: ReturnType<typeof longMessages>) => compileContextWithOptionalSummary(
      tmpDir, 'discussion', 'discussion-123', msgs, '', [summaryAgent], () => provider, async () => {}
    );
    await run(messages);
    expect(calls).toBe(1);

    const grown = [...messages, ...longMessages(2).map((m, i) => ({
      ...m,
      id: `discussion-123:message-${String(15 + i).padStart(4, '0')}`,
      agentName: `Agent ${14 + i}`
    }))];
    const compiled = await run(grown);
    expect(calls).toBe(1);
    expect(compiled.summaryUsed).toBe(true);
    expect(compiled.historyBlock).toContain('not yet folded into this summary');
  });

  it('rolls the summary forward when many new messages are uncovered', async () => {
    const prompts: string[] = [];
    const provider = { execute: async (prompt: string) => { prompts.push(prompt); return 'rolled summary'; } } as unknown as Provider;
    const messages = longMessages(14);
    const run = (msgs: ReturnType<typeof longMessages>) => compileContextWithOptionalSummary(
      tmpDir, 'discussion', 'discussion-123', msgs, '', [summaryAgent], () => provider, async () => {}
    );
    await run(messages);

    const grown = [...messages, ...longMessages(8).map((m, i) => ({
      ...m,
      id: `discussion-123:message-${String(15 + i).padStart(4, '0')}`,
      agentName: `Agent ${14 + i}`
    }))];
    const compiled = await run(grown);
    expect(compiled.summaryUsed).toBe(true);
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain('Existing summary:');
  });
});

describe('composeProjectContext', () => {
  it('puts selected context before overview and structure', () => {
    const result = composeProjectContext({
      overview: 'OVERVIEW',
      structure: 'STRUCTURE',
      additionalContext: 'SELECTED'
    });
    expect(result.indexOf('SELECTED')).toBeLessThan(result.indexOf('OVERVIEW'));
    expect(result.indexOf('OVERVIEW')).toBeLessThan(result.indexOf('STRUCTURE'));
    expect(result).toContain('Selected Context:\nSELECTED');
    expect(result).toContain('Workspace Structure:\nSTRUCTURE');
  });

  it('keeps the selected context when the budget forces trimming', () => {
    const projectContext = composeProjectContext({
      overview: 'OVERVIEW '.repeat(2000),
      additionalContext: 'SELECTED-PRIORITY-CONTEXT'
    });
    const compiled = compileDiscussionContext([], projectContext, { maxProjectContextTokens: 200 });
    expect(compiled.projectContextBlock).toContain('SELECTED-PRIORITY-CONTEXT');
  });

  it('omits empty sections', () => {
    expect(composeProjectContext({ overview: '  ' })).toBe('');
    expect(composeProjectContext({ structure: 'S' })).toBe('Workspace Structure:\nS');
  });
});

describe('loadWorkspaceMemoryContext', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-mem-'));
    await fs.mkdir(path.join(tmpDir, '.room', 'decisions'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.room', 'documents'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when no memory files exist', async () => {
    expect(await loadWorkspaceMemoryContext(tmpDir)).toBe('');
  });

  it('includes recent ADRs and discussion summaries', async () => {
    await fs.writeFile(path.join(tmpDir, '.room', 'decisions', 'ADR-001-db.md'), 'Use SQLite.');
    await fs.writeFile(path.join(tmpDir, '.room', 'documents', 'topic-discussion-1-summary.md'), 'Past summary body.');
    const memory = await loadWorkspaceMemoryContext(tmpDir);
    expect(memory).toContain('Workspace Memory');
    expect(memory).toContain('[Decision: ADR-001-db.md]');
    expect(memory).toContain('Use SQLite.');
    expect(memory).toContain('[Past Discussion Summary: topic-discussion-1-summary.md]');
  });

  it('excludes the current discussion own summary and non-matching files', async () => {
    await fs.writeFile(path.join(tmpDir, '.room', 'documents', 'topic-discussion-9-summary.md'), 'Own summary.');
    await fs.writeFile(path.join(tmpDir, '.room', 'decisions', 'task-123-artifact.md'), 'Not an ADR.');
    const memory = await loadWorkspaceMemoryContext(tmpDir, 2500, 'discussion-9');
    expect(memory).not.toContain('Own summary.');
    expect(memory).not.toContain('Not an ADR.');
  });

  it('trims to the token budget', async () => {
    await fs.writeFile(path.join(tmpDir, '.room', 'decisions', 'ADR-001-big.md'), 'word '.repeat(10000));
    const memory = await loadWorkspaceMemoryContext(tmpDir, 200);
    expect(memory).toContain('[Workspace memory trimmed to fit the prompt budget.]');
  });
});

describe('buildSkillsContext', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-skills-'));
    await fs.mkdir(path.join(tmpDir, '.room', 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when no skills are given or loadable', async () => {
    expect(await buildSkillsContext(tmpDir, [])).toBe('');
    expect(await buildSkillsContext(tmpDir, ['missing.md'])).toBe('');
  });

  it('injects skill content without frontmatter', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.room', 'skills', 'api.md'),
      '---\nalwaysApply: true\n---\nAlways version the API.'
    );
    const context = await buildSkillsContext(tmpDir, ['api.md']);
    expect(context).toContain('=== Active Skills ===');
    expect(context).toContain('[Skill: api.md]');
    expect(context).toContain('Always version the API.');
    expect(context).not.toContain('alwaysApply');
  });

  it('trims oversized skills to the per-skill budget', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.room', 'skills', 'big.md'),
      `guideline ${'word '.repeat(20000)}`
    );
    const context = await buildSkillsContext(tmpDir, ['big.md'], 200);
    expect(context).toContain('[Skill content trimmed to fit the prompt budget.]');
    expect(context.length).toBeLessThan(5000);
  });
});
