# Discussion Engine Token & Context Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut per-discussion token cost and improve cross-turn / cross-discussion context understanding in the ROOM discussion engine (`packages/engine/src/discussion/`).

**Architecture:** Nine incremental changes to the existing discussion pipeline: tighter agent-output protocol, SKIP turns, token-budgeted moderator/summarizer transcripts, a fixed + observable context-summary pipeline, prefix-reusable rolling summary cache, prioritized project-context composition, workspace-memory injection, stable short-ID message references, and dated timestamps. No new packages; all changes stay inside `@room/engine` and are covered by vitest unit tests.

**Tech Stack:** TypeScript (ESM, `"type": "module"` — relative imports MUST end in `.js`), Node `fs/promises`, vitest.

## Global Constraints

- Run tests with: `npm test -w packages/engine` (vitest run). Run a single file with `npx vitest run <path> -w packages/engine` from repo root or `npx vitest run src/discussion/<file>.test.ts` from `packages/engine/`.
- Build/typecheck with: `npm run build:engine` (also runs `scripts/guard-file-size.js` — keep source files from growing unnecessarily).
- `packages/engine/dist/` is gitignored generated output — never edit or commit it.
- Code style: 2-space indent, single quotes, semicolons, existing naming conventions. Relative imports end with `.js`.
- Commit messages follow the repo convention `feat(discussion): ...` / `fix(engine): ...` and end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Prompt-text constants are user-visible engine behavior: copy them exactly as written in this plan.
- Do not change public behavior of `taskRunner.ts` call sites except where a task explicitly says so (new parameters must be optional).

---

### Task 1: Agent response budget in the discussion protocol

Agents currently write 2,400–6,000 chars per message and every message is re-sent to every later agent turn, so output size compounds quadratically. Add a length budget and a no-restating rule to the protocol constant.

**Files:**
- Modify: `packages/engine/src/discussion/discussionRunner.ts:30-34`

**Interfaces:**
- Consumes: nothing new.
- Produces: updated `DISCUSSION_PROTOCOL` string constant (module-private; Task 2 edits it again, additively).

- [ ] **Step 1: Replace the protocol constant**

Replace the existing constant:

```ts
const DISCUSSION_PROTOCOL = `=== Discussion Protocol ===
Speak in the first person as your assigned AI member role.
Maintain a professional, constructive team tone.
Your replies should be direct, specific, and build upon prior team responses.
Ensure all files, lines, and commands you reference are valid within the workspace.`;
```

with:

```ts
const DISCUSSION_PROTOCOL = `=== Discussion Protocol ===
Speak in the first person as your assigned AI member role.
Maintain a professional, constructive team tone.
Your replies should be direct, specific, and build upon prior team responses.
Keep each reply under roughly 300 words unless the user explicitly asks for exhaustive detail.
Do not restate points already made in the discussion history; reference them by their visible Message number and add only new reasoning, objections, evidence, or decisions.
Ensure all files, lines, and commands you reference are valid within the workspace.`;
```

(No unit test: this is a prose constant with no branching logic; the existing suite guards compilation.)

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: build passes, all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/discussion/discussionRunner.ts
git commit -m "feat(discussion): add response length budget to discussion protocol

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: SKIP turns for agents with nothing to add

Round-robin currently forces every agent to speak every round; round 2 in real logs is mostly restated positions. Let an agent reply `SKIP: <reason>` and store it as a one-line message so it costs almost nothing in later prompts.

**Files:**
- Modify: `packages/engine/src/discussion/utils.ts` (add `parseSkipTurn` near the other response-cleaning helpers)
- Modify: `packages/engine/src/discussion/discussionRunner.ts` (protocol text + response handling)
- Test: `packages/engine/src/discussion/utils.test.ts` (new file)

**Interfaces:**
- Consumes: `DISCUSSION_PROTOCOL` from Task 1.
- Produces: `export function parseSkipTurn(response: string): string | null` in `utils.ts` — returns the one-line skip reason, or `null` when the response is not a skip. Also emits a new `DiscussionEvent` with `type: 'agent_skipped'` and `reason` set (the `DiscussionEvent` interface at `discussionRunner.ts:38-53` already has optional `reason`, so no type change).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/discussion/utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSkipTurn } from './utils.js';

describe('parseSkipTurn', () => {
  it('parses a skip response into its one-line reason', () => {
    expect(parseSkipTurn('SKIP: nothing to add beyond Message 4')).toBe('nothing to add beyond Message 4');
  });

  it('trims and keeps only the first line of the reason', () => {
    expect(parseSkipTurn('SKIP: agreed with prior round\nextra trailing line')).toBe('agreed with prior round');
  });

  it('returns a default reason when the reason is empty', () => {
    expect(parseSkipTurn('SKIP:   ')).toBe('No additional points.');
  });

  it('returns null for normal responses', () => {
    expect(parseSkipTurn('I think we should use SQLite here.')).toBeNull();
  });

  it('returns null when SKIP is not at the start', () => {
    expect(parseSkipTurn('We could SKIP: this step')).toBeNull();
  });

  it('returns null for long responses that merely start with SKIP:', () => {
    expect(parseSkipTurn(`SKIP: ${'x'.repeat(500)}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/discussion/utils.test.ts` (from `packages/engine/`)
Expected: FAIL — `parseSkipTurn` is not exported.

- [ ] **Step 3: Implement `parseSkipTurn` in `utils.ts`**

Add after `composeAgentSystemPrompt` (around line 51):

```ts
export function parseSkipTurn(response: string): string | null {
  const trimmed = response.trim();
  if (!trimmed || trimmed.length > 400) return null;
  const match = trimmed.match(/^SKIP:\s*([\s\S]*)$/);
  if (!match) return null;
  const reason = match[1].split('\n')[0].trim();
  return reason || 'No additional points.';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/discussion/utils.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the skip rule to the protocol and wire it into the runner**

In `discussionRunner.ts`, append one line to `DISCUSSION_PROTOCOL` (after the "Do not restate..." line from Task 1):

```
If you have nothing material to add this turn, reply with exactly "SKIP: <one short line saying why>" and nothing else.
```

Add `parseSkipTurn` to the existing import from `./utils.js`.

Then, inside the `try` block, replace:

```ts
        response = cleanAgentUserContent(response, dirPath);
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
```

with:

```ts
        response = cleanAgentUserContent(response, dirPath);
        const skipReason = parseSkipTurn(response);
        if (skipReason) {
          successfulAgentRuns++;
          response = `[${agent.name} skipped this turn: ${skipReason}]`;
          options.onEvent?.({
            type: 'agent_skipped',
            discussionId,
            agentName: agent.name,
            providerName: agent.provider,
            ...(agent.modelName ? { modelName: agent.modelName } : {}),
            round,
            reason: skipReason
          });
        } else {
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
        }
```

Note: a reviewer that skips does not approve — `isExplicitlyApproved('[X skipped this turn: ...]')` is false, which is the desired behavior.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/utils.ts packages/engine/src/discussion/utils.test.ts packages/engine/src/discussion/discussionRunner.ts
git commit -m "feat(discussion): let agents skip turns with SKIP: replies

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Token-budgeted transcripts for moderator and summarizer

`evaluateDiscussionLoop` (`moderatorRunner.ts:59`), `generateTasksFromDiscussionLoop` (`moderatorRunner.ts:170`) and `summarizeDiscussionLoop` (`contextBuilder.ts:273`) send `renderDiscussionMarkdown(entire log)` — real logs reach 118KB (~30k+ tokens) in a single prompt. Reuse the already-tested `compileDiscussionContext` to build a budgeted transcript.

**Files:**
- Modify: `packages/engine/src/discussion/contextBuilder.ts` (add helper, use it in `summarizeDiscussionLoop`)
- Modify: `packages/engine/src/discussion/moderatorRunner.ts:59,170`
- Test: `packages/engine/src/discussion/contextBuilder.test.ts` (new file)

**Interfaces:**
- Consumes: `compileDiscussionContext(messages, projectContext, options)` from `./contextCompiler.js`; `estimateTokenCount` from `./tokenBudget.js`; `DiscussionLog` from `./types.js`.
- Produces: `export function buildBudgetedTranscript(log: DiscussionLog, maxHistoryTokens = 20000): string` in `contextBuilder.ts`. Later tasks do not depend on it.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/discussion/contextBuilder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildBudgetedTranscript } from './contextBuilder.js';
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: FAIL — `buildBudgetedTranscript` is not exported.

- [ ] **Step 3: Implement the helper**

In `contextBuilder.ts`, add after `compileContextWithOptionalSummary`:

```ts
export function buildBudgetedTranscript(log: DiscussionLog, maxHistoryTokens = 20000): string {
  const compiled = compileDiscussionContext(log.messages, '', {
    maxHistoryTokens,
    maxMessageTokens: Math.min(3500, maxHistoryTokens)
  });
  return `# ${log.title}\n\n## Current Topic\n${log.topic || 'Untitled'}\n\n## Status\n${log.status}\n\n## Transcript\n${compiled.historyBlock}`;
}
```

(`DiscussionLog` is already imported in this file; `compileDiscussionContext` is already imported too.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use the helper at all three unbounded call sites**

In `contextBuilder.ts` `summarizeDiscussionLoop`, replace:

```ts
  const transcript = renderDiscussionMarkdown(discussionLog);
```

with:

```ts
  const transcript = buildBudgetedTranscript(discussionLog);
```

In `moderatorRunner.ts`, add `buildBudgetedTranscript` to the imports:

```ts
import {
  compileContextWithOptionalSummary,
  buildBudgetedTranscript
} from './contextBuilder.js';
```

(Note: `moderatorRunner.ts` does not currently import from `contextBuilder.js` — add a new import line. Keep the existing `renderDiscussionMarkdown` import because it is still used to write the `.md` log file at line 142.)

Then replace **both** occurrences of:

```ts
  const transcript = renderDiscussionMarkdown(discussionLog);
```

(lines 59 and 170) with:

```ts
  const transcript = buildBudgetedTranscript(discussionLog);
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS. (`renderDiscussionMarkdown` may become unused in `contextBuilder.ts` — remove it from that file's import list if `tsc` flags it or it is genuinely unused there.)

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/contextBuilder.ts packages/engine/src/discussion/contextBuilder.test.ts packages/engine/src/discussion/moderatorRunner.ts
git commit -m "feat(discussion): budget moderator and summarizer transcripts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Fix the context-summary pipeline and surface its failures

Real runs show `summaryUsed: false` on every turn and zero `.context-summary.json` files even when thresholds were exceeded — the summary pipeline fails silently (`console.warn` only) and agents lose omitted context. Two fixes: (a) pick the summary agent from the **discussion participants** (already execution-approved) instead of all workspace agents, and (b) emit summary lifecycle events to `onEvent` so failures are visible.

**Files:**
- Modify: `packages/engine/src/discussion/contextBuilder.ts` (`compileContextWithOptionalSummary`)
- Modify: `packages/engine/src/discussion/discussionRunner.ts:239-248` (call site)
- Test: `packages/engine/src/discussion/contextBuilder.test.ts` (extend)

**Interfaces:**
- Consumes: existing cache/summarizer functions already imported in `contextBuilder.ts`.
- Produces:

```ts
export interface ContextSummaryEvent {
  type: 'context_summary_generated' | 'context_summary_reused' | 'context_summary_failed';
  contextId: string;
  candidateCount: number;
  error?: string;
}
```

and a new optional trailing parameter on `compileContextWithOptionalSummary`:

```ts
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
): Promise<CompiledDiscussionContext>
```

`taskRunner.ts` call sites (lines 228, 336) keep working unchanged because the parameter is optional.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/discussion/contextBuilder.test.ts`:

```ts
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach } from 'vitest';
import { compileContextWithOptionalSummary, type ContextSummaryEvent } from './contextBuilder.js';
import type { AgentConfig } from '../agents/registry.js';
import type { Provider } from '../providers/provider.js';

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

describe('compileContextWithOptionalSummary', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-ctx-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('emits context_summary_failed and falls back to the draft when the provider throws', async () => {
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
    const args = [
      tmpDir, 'discussion', 'discussion-123', messages, '', [summaryAgent],
      () => provider, async () => {}, (event: ContextSummaryEvent) => events.push(event)
    ] as const;

    const first = await compileContextWithOptionalSummary(...args);
    expect(first.summaryUsed).toBe(true);
    expect(first.historyBlock).toContain('compact summary of older messages');
    expect(events[0].type).toBe('context_summary_generated');

    const second = await compileContextWithOptionalSummary(...args);
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
});
```

(Move the shared `import { describe, expect, it } ...` merge as needed — vitest imports live at the top of the file.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: the three new tests FAIL (no `onSummaryEvent` parameter / no `ContextSummaryEvent` export); Task 3 tests still PASS.

- [ ] **Step 3: Implement events in `compileContextWithOptionalSummary`**

Replace the body of `compileContextWithOptionalSummary` in `contextBuilder.ts` with:

```ts
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
  if (isReusableContextSummaryCache(existingCache, messages, candidateIndexes)) {
    emit('context_summary_reused');
    return compileDiscussionContext(messages, projectContext, {
      summary: existingCache.summary
    });
  }

  if (!shouldGenerateContextSummary(messages, candidateIndexes)) {
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
    const summary = await summarizeContextMessages(
      provider,
      systemPrompt,
      messages,
      candidateIndexes,
      DEFAULT_CONTEXT_SUMMARY_POLICY
    );
    const cache = createContextSummaryCache(source, contextId, messages, candidateIndexes, summary);
    await writeContextSummaryCache(cacheInput, cache);
    emit('context_summary_generated');
    return compileDiscussionContext(messages, projectContext, { summary });
  } catch (err: any) {
    console.warn(`[Discussion Engine] Skipped context summary cache for ${contextId}: ${err.message}`);
    emit('context_summary_failed', err.message);
    return draftContext;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire participants + events at the discussion call site**

In `discussionRunner.ts`, replace the call at lines 239-248:

```ts
      const compiledContext = await compileContextWithOptionalSummary(
        dirPath,
        'discussion',
        discussionId,
        discussionLog.messages,
        projectContext,
        agents,
        getProvider,
        assertAgentExecutionAllowed
      );
```

with:

```ts
      const compiledContext = await compileContextWithOptionalSummary(
        dirPath,
        'discussion',
        discussionId,
        discussionLog.messages,
        projectContext,
        workflowAgents,
        getProvider,
        assertAgentExecutionAllowed,
        summaryEvent => options.onEvent?.({
          type: summaryEvent.type,
          discussionId,
          round,
          ...(summaryEvent.error ? { error: summaryEvent.error } : {})
        })
      );
```

Passing `workflowAgents` (the actual participants, in execution order) instead of all workspace agents means the summary agent is one the user already approved for this discussion — the most likely root cause of the silent failures. `pickContextSummaryAgent` still prefers a reporter/scribe/summary member among them.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS (taskRunner call sites compile unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/contextBuilder.ts packages/engine/src/discussion/contextBuilder.test.ts packages/engine/src/discussion/discussionRunner.ts
git commit -m "fix(discussion): pick summary agent from participants and surface summary failures

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Prefix-reusable summary cache with rolling updates

The cache requires the candidate index set to match exactly, but candidates grow almost every turn — so every turn re-summarizes the whole omitted set from scratch. Add: (a) prefix reuse — if the cached summary covers a prefix of current candidates and ≤ 4 messages are uncovered, reuse it with a note; (b) rolling update — when > 4 are uncovered, summarize (old summary + new messages) instead of everything.

**Files:**
- Modify: `packages/engine/src/discussion/contextSummaryCache.ts` (add `checkContextSummaryCacheReuse`)
- Modify: `packages/engine/src/discussion/contextSummarizer.ts` (add `updateContextSummary`, `MAX_UNSUMMARIZED_OMITTED_MESSAGES`)
- Modify: `packages/engine/src/discussion/contextBuilder.ts` (use both in `compileContextWithOptionalSummary`)
- Test: `packages/engine/src/discussion/contextSummaryCache.test.ts`, `packages/engine/src/discussion/contextBuilder.test.ts` (extend both)

**Interfaces:**
- Consumes: `ContextSummaryCache`, `hashSummaryInput`, `PromptHistoryMessage` (existing); Task 4's `emit` pattern inside `compileContextWithOptionalSummary`.
- Produces:

```ts
// contextSummaryCache.ts
export interface ContextSummaryCacheReuse {
  exact: boolean;
  prefix: boolean;
  uncoveredIndexes: number[];
}
export function checkContextSummaryCacheReuse(
  cache: ContextSummaryCache | null,
  messages: PromptHistoryMessage[],
  candidateIndexes: number[]
): ContextSummaryCacheReuse;

// contextSummarizer.ts
export const MAX_UNSUMMARIZED_OMITTED_MESSAGES = 4;
export async function updateContextSummary(
  provider: Provider,
  systemPrompt: string,
  previousSummary: string,
  messages: PromptHistoryMessage[],
  uncoveredIndexes: number[],
  policy?: ContextSummaryPolicy
): Promise<string>;
```

- [ ] **Step 1: Write the failing cache tests**

Append to `packages/engine/src/discussion/contextSummaryCache.test.ts` (match the existing test style in that file):

```ts
import { checkContextSummaryCacheReuse, createContextSummaryCache } from './contextSummaryCache.js';

function cacheMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `discussion-1:message-${String(index + 1).padStart(4, '0')}`,
    type: 'agent' as const,
    agentName: `Agent ${index}`,
    providerName: 'Claude',
    content: `content ${index}`,
    timestamp: '10:00'
  }));
}

describe('checkContextSummaryCacheReuse', () => {
  const messages = cacheMessages(10);

  it('reports exact reuse when candidates match the cache', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', messages, [1, 2, 3], 'sum');
    expect(checkContextSummaryCacheReuse(cache, messages, [1, 2, 3]))
      .toEqual({ exact: true, prefix: true, uncoveredIndexes: [] });
  });

  it('reports prefix reuse with the uncovered tail', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', messages, [1, 2, 3], 'sum');
    expect(checkContextSummaryCacheReuse(cache, messages, [1, 2, 3, 4, 5]))
      .toEqual({ exact: false, prefix: true, uncoveredIndexes: [4, 5] });
  });

  it('rejects non-prefix candidate sets', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', messages, [1, 2, 3], 'sum');
    expect(checkContextSummaryCacheReuse(cache, messages, [2, 3, 4]).prefix).toBe(false);
  });

  it('rejects when covered message content changed (hash mismatch)', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', messages, [1, 2, 3], 'sum');
    const mutated = cacheMessages(10);
    mutated[2] = { ...mutated[2], content: 'edited' };
    expect(checkContextSummaryCacheReuse(cache, mutated, [1, 2, 3, 4]).prefix).toBe(false);
  });

  it('rejects a null cache', () => {
    expect(checkContextSummaryCacheReuse(null, messages, [1, 2]))
      .toEqual({ exact: false, prefix: false, uncoveredIndexes: [1, 2] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/discussion/contextSummaryCache.test.ts`
Expected: FAIL — `checkContextSummaryCacheReuse` not exported.

- [ ] **Step 3: Implement `checkContextSummaryCacheReuse`**

Add to `contextSummaryCache.ts` (after `isReusableContextSummaryCache`):

```ts
export interface ContextSummaryCacheReuse {
  exact: boolean;
  prefix: boolean;
  uncoveredIndexes: number[];
}

export function checkContextSummaryCacheReuse(
  cache: ContextSummaryCache | null,
  messages: PromptHistoryMessage[],
  candidateIndexes: number[]
): ContextSummaryCacheReuse {
  const noReuse: ContextSummaryCacheReuse = { exact: false, prefix: false, uncoveredIndexes: candidateIndexes };
  if (!cache || cache.summarizedMessageIndexes.length === 0) return noReuse;
  const covered = cache.summarizedMessageIndexes;
  if (covered.length > candidateIndexes.length) return noReuse;
  if (!covered.every((value, index) => value === candidateIndexes[index])) return noReuse;
  if (cache.summaryInputHash !== hashSummaryInput(messages, covered)) return noReuse;
  const uncoveredIndexes = candidateIndexes.slice(covered.length);
  return { exact: uncoveredIndexes.length === 0, prefix: true, uncoveredIndexes };
}
```

- [ ] **Step 4: Run cache tests to verify they pass**

Run: `npx vitest run src/discussion/contextSummaryCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `updateContextSummary` in `contextSummarizer.ts`**

Add after `summarizeContextMessages`:

```ts
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
```

Add a unit test to `contextSummarizer.test.ts` (match existing style — it stubs a provider):

```ts
import { updateContextSummary } from './contextSummarizer.js';

describe('updateContextSummary', () => {
  it('sends the previous summary plus only the uncovered messages', async () => {
    let captured = '';
    const provider = { execute: async (prompt: string) => { captured = prompt; return 'updated summary'; } } as any;
    const messages = [0, 1, 2, 3].map(index => ({
      agentName: `Agent ${index}`,
      providerName: 'Claude',
      content: `content ${index}`,
      timestamp: '10:00'
    }));
    const result = await updateContextSummary(provider, 'sys', 'old summary', messages, [2, 3]);
    expect(result).toBe('updated summary');
    expect(captured).toContain('old summary');
    expect(captured).toContain('content 2');
    expect(captured).toContain('content 3');
    expect(captured).not.toContain('content 0');
  });
});
```

Run: `npx vitest run src/discussion/contextSummarizer.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing pipeline tests, then rework `compileContextWithOptionalSummary`**

Append to `contextBuilder.test.ts` inside the `compileContextWithOptionalSummary` describe block:

```ts
  it('reuses a prefix cache with a note instead of calling the provider', async () => {
    let calls = 0;
    const provider = { execute: async () => { calls++; return 'base summary'; } } as unknown as Provider;
    const messages = longMessages(14);
    const run = (msgs: ReturnType<typeof longMessages>) => compileContextWithOptionalSummary(
      tmpDir, 'discussion', 'discussion-123', msgs, '', [summaryAgent], () => provider, async () => {}
    );
    await run(messages); // generates + caches
    expect(calls).toBe(1);

    // two more long messages -> up to 2 extra omitted candidates (<= 4): prefix reuse, no new call
    const grown = [...messages, ...longMessages(2).map((m, i) => ({ ...m, id: `discussion-123:message-${String(15 + i).padStart(4, '0')}`, agentName: `Agent ${14 + i}` }))];
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

    const grown = [...messages, ...longMessages(8).map((m, i) => ({ ...m, id: `discussion-123:message-${String(15 + i).padStart(4, '0')}`, agentName: `Agent ${14 + i}` }))];
    const compiled = await run(grown);
    expect(compiled.summaryUsed).toBe(true);
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain('Existing summary:');
  });
```

Run: `npx vitest run src/discussion/contextBuilder.test.ts` — expect the two new tests to FAIL.

Then in `contextBuilder.ts`:

Add imports:

```ts
import { checkContextSummaryCacheReuse } from './contextSummaryCache.js';   // add to existing import list
import { updateContextSummary, MAX_UNSUMMARIZED_OMITTED_MESSAGES } from './contextSummarizer.js'; // add to existing import list
```

Replace the cache/generation section of `compileContextWithOptionalSummary` (everything from `const existingCache = ...` through the final `catch`) with:

```ts
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
  } catch (err: any) {
    console.warn(`[Discussion Engine] Skipped context summary cache for ${contextId}: ${err.message}`);
    emit('context_summary_failed', err.message);
    return draftContext;
  }
```

(`isReusableContextSummaryCache` becomes unused in this file — remove it from the import list. Keep the function itself in `contextSummaryCache.ts`; other tests use it.)

- [ ] **Step 7: Run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS, including Task 4's tests (exact-reuse path still emits `context_summary_reused`).

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/discussion/contextSummaryCache.ts packages/engine/src/discussion/contextSummaryCache.test.ts packages/engine/src/discussion/contextSummarizer.ts packages/engine/src/discussion/contextSummarizer.test.ts packages/engine/src/discussion/contextBuilder.ts packages/engine/src/discussion/contextBuilder.test.ts
git commit -m "feat(discussion): reuse summary cache prefixes and roll summaries forward

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Prioritize user-selected context over generic project context

`discussionRunner.ts:121-137` concatenates overview → structure → selected context, and `trimTextToTokenBudget` trims from the tail — so the user's hand-picked context is cut first. Extract a pure composer that puts selected context first.

**Files:**
- Modify: `packages/engine/src/discussion/contextBuilder.ts` (add `composeProjectContext`)
- Modify: `packages/engine/src/discussion/discussionRunner.ts:121-137`
- Test: `packages/engine/src/discussion/contextBuilder.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
export function composeProjectContext(input: {
  overview?: string;
  structure?: string;
  additionalContext?: string;
  workspaceMemory?: string;  // filled by Task 7; empty/undefined until then
}): string;
```

Ordering contract (highest survival priority first, because trimming cuts the tail): `additionalContext` → `overview` → `workspaceMemory` → `structure`.

- [ ] **Step 1: Write the failing test**

Append to `contextBuilder.test.ts`:

```ts
import { composeProjectContext } from './contextBuilder.js';
import { compileDiscussionContext } from './contextCompiler.js';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: new tests FAIL — `composeProjectContext` not exported.

- [ ] **Step 3: Implement `composeProjectContext`**

Add to `contextBuilder.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the discussion runner**

In `discussionRunner.ts`, replace lines 121-137:

```ts
  let projectContext = '';
  const overview = await readFirstExistingFile([
    path.join(dirPath, '.room', 'context', 'overview.md'),
    path.join(dirPath, '.room', 'workspace.md'),
    path.join(dirPath, '.room', 'project.md')
  ]);
  const structure = await readFirstExistingFile([
    path.join(dirPath, '.room', 'context', 'structure.md'),
    path.join(dirPath, '.room', 'architecture', 'current.md')
  ]);
  projectContext = overview;
  if (structure) {
    projectContext += `\n\nWorkspace Structure:\n${structure}`;
  }
  if (options.additionalContext?.trim()) {
    projectContext += `\n\nSelected Context:\n${options.additionalContext.trim()}`;
  }
```

with:

```ts
  const overview = await readFirstExistingFile([
    path.join(dirPath, '.room', 'context', 'overview.md'),
    path.join(dirPath, '.room', 'workspace.md'),
    path.join(dirPath, '.room', 'project.md')
  ]);
  const structure = await readFirstExistingFile([
    path.join(dirPath, '.room', 'context', 'structure.md'),
    path.join(dirPath, '.room', 'architecture', 'current.md')
  ]);
  const projectContext = composeProjectContext({
    overview,
    structure,
    additionalContext: options.additionalContext
  });
```

Add `composeProjectContext` to the existing import from `./contextBuilder.js`.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/contextBuilder.ts packages/engine/src/discussion/contextBuilder.test.ts packages/engine/src/discussion/discussionRunner.ts
git commit -m "feat(discussion): prioritize user-selected context in prompt budget

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Inject workspace memory (ADRs + past discussion summaries)

Discussions never see `.room/decisions/ADR-*.md` or the `*-summary.md` documents that `summarizeDiscussionLoop` writes — agents "forget" past conclusions. Load the most recent ones into project context under a small dedicated budget.

**Files:**
- Modify: `packages/engine/src/discussion/contextBuilder.ts` (add `loadWorkspaceMemoryContext` + private helper)
- Modify: `packages/engine/src/discussion/discussionRunner.ts` (wire into `composeProjectContext`)
- Test: `packages/engine/src/discussion/contextBuilder.test.ts` (extend)

**Interfaces:**
- Consumes: `composeProjectContext` (Task 6 — its `workspaceMemory` parameter), `trimTextToTokenBudget` from `./tokenBudget.js` (add to imports).
- Produces:

```ts
export async function loadWorkspaceMemoryContext(
  dirPath: string,
  maxTokens = 2500,
  excludeId?: string  // current discussion id; its own summary must not be re-injected
): Promise<string>;   // '' when nothing exists
```

Selection rule: newest 3 files matching `ADR-*.md` in `.room/decisions/`, newest 2 files matching `*-summary.md` in `.room/documents/`, newest-first by mtime, joined and trimmed to `maxTokens`.

- [ ] **Step 1: Write the failing test**

Append to `contextBuilder.test.ts` (reuse the `tmpDir` beforeEach/afterEach pattern from Task 4 in a new describe block):

```ts
import { loadWorkspaceMemoryContext } from './contextBuilder.js';

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

  it('excludes the current discussion\'s own summary and non-matching files', async () => {
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: new tests FAIL — `loadWorkspaceMemoryContext` not exported.

- [ ] **Step 3: Implement the loader**

In `contextBuilder.ts`, add `trimTextToTokenBudget` import:

```ts
import { trimTextToTokenBudget } from './tokenBudget.js';
```

Add the functions:

```ts
export async function loadWorkspaceMemoryContext(
  dirPath: string,
  maxTokens = 2500,
  excludeId?: string
): Promise<string> {
  const sections: string[] = [];

  const adrs = await listMarkdownByMtime(
    path.join(dirPath, '.room', 'decisions'),
    file => /^ADR-/i.test(file)
  );
  for (const adr of adrs.slice(0, 3)) {
    sections.push(`[Decision: ${adr.name}]\n${adr.content.trim()}`);
  }

  const summaries = await listMarkdownByMtime(
    path.join(dirPath, '.room', 'documents'),
    file => file.endsWith('-summary.md') && (!excludeId || !file.includes(excludeId))
  );
  for (const doc of summaries.slice(0, 2)) {
    sections.push(`[Past Discussion Summary: ${doc.name}]\n${doc.content.trim()}`);
  }

  if (sections.length === 0) return '';
  const fitted = trimTextToTokenBudget(sections.join('\n\n'), maxTokens);
  return `Workspace Memory (recent decisions and past discussion summaries):\n${fitted.text}${fitted.truncated ? '\n\n[Workspace memory trimmed to fit the prompt budget.]' : ''}`;
}

async function listMarkdownByMtime(
  dir: string,
  match: (file: string) => boolean
): Promise<{ name: string; content: string }[]> {
  try {
    const files = (await fs.readdir(dir)).filter(file => file.toLowerCase().endsWith('.md') && match(file));
    const stats = await Promise.all(files.map(async name => ({
      name,
      mtimeMs: (await fs.stat(path.join(dir, name))).mtimeMs
    })));
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return Promise.all(stats.map(async ({ name }) => ({
      name,
      content: await fs.readFile(path.join(dir, name), 'utf-8')
    })));
  } catch {
    return [];
  }
}
```

Careful with the `excludeId` filter: summary filenames end with `-<discussionId>-summary.md` (see `summarizeDiscussionLoop`), so `file.includes(excludeId)` correctly matches the current discussion's own summary.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the discussion runner**

In `discussionRunner.ts`, extend the Task 6 block:

```ts
  const workspaceMemory = await loadWorkspaceMemoryContext(dirPath, 2500, discussionId);
  const projectContext = composeProjectContext({
    overview,
    structure,
    additionalContext: options.additionalContext,
    workspaceMemory
  });
```

Add `loadWorkspaceMemoryContext` to the import from `./contextBuilder.js`.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/contextBuilder.ts packages/engine/src/discussion/contextBuilder.test.ts packages/engine/src/discussion/discussionRunner.ts
git commit -m "feat(discussion): inject recent ADRs and summaries as workspace memory

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Stable short-ID message references

`room-refs` cites "visible Message number", which shifts whenever older messages fall out of the prompt window. Messages already have stable IDs (`<scopeId>:message-0007`). Show a short form (`m0007`) in each history header and let agents cite it; keep number-based citation as fallback.

**Files:**
- Modify: `packages/engine/src/discussion/references.ts` (add `shortMessageRef`, extend parser)
- Modify: `packages/engine/src/discussion/contextCompiler.ts` (`formatMessageForPromptHistory` shows the short id)
- Modify: `packages/engine/src/discussion/utils.ts` (`REFERENCE_TRACING_PROTOCOL` text)
- Test: `packages/engine/src/discussion/references.test.ts`, `packages/engine/src/discussion/contextCompiler.test.ts` (extend both)

**Interfaces:**
- Produces:

```ts
// references.ts
export function shortMessageRef(id?: string): string;  // 'discussion-1:message-0007' -> 'm0007'; '' when id has no message-NNNN suffix
```

- `parseMessageReferences` additionally accepts `{"id": "m0007", ...}` entries and resolves them against `ReferenceResolutionContext.id` (numeric comparison of the `message-NNNN` suffix, so padding differences don't matter). ID resolution wins over number resolution when both are present.
- Prompt history headers become: `--- Message 3 [m0007]: Architect (Claude) ---` (bracket part omitted when the message has no id).

- [ ] **Step 1: Write the failing reference tests**

Append to `references.test.ts` (match its existing style):

```ts
import { parseMessageReferences, shortMessageRef } from './references.js';

describe('shortMessageRef', () => {
  it('shortens a stable message id', () => {
    expect(shortMessageRef('discussion-1:message-0007')).toBe('m0007');
  });
  it('returns empty for missing or unrecognized ids', () => {
    expect(shortMessageRef(undefined)).toBe('');
    expect(shortMessageRef('something-else')).toBe('');
  });
});

describe('parseMessageReferences with short ids', () => {
  const context = [
    { promptNumber: 1, id: 'discussion-1:message-0002', agentName: 'You' },
    { promptNumber: 2, id: 'discussion-1:message-0007', agentName: 'Architect' }
  ];

  it('resolves an id-based reference to the full message id', () => {
    const content = 'Reply.\n```room-refs\n{"references": [{"id": "m0007", "reason": "built on it"}]}\n```';
    const { references } = parseMessageReferences(content, context);
    expect(references).toEqual([
      { messageId: 'discussion-1:message-0007', author: 'Architect', reason: 'built on it' }
    ]);
  });

  it('prefers id resolution over a mismatched message number', () => {
    const content = 'Reply.\n```room-refs\n{"references": [{"id": "m0002", "message": 2, "reason": "r"}]}\n```';
    const { references } = parseMessageReferences(content, context);
    expect(references[0].messageId).toBe('discussion-1:message-0002');
    expect(references[0].author).toBe('You');
  });

  it('still resolves legacy number-only references', () => {
    const content = 'Reply.\n```room-refs\n{"references": [{"message": 2, "author": "Architect", "reason": "r"}]}\n```';
    const { references } = parseMessageReferences(content, context);
    expect(references[0].messageId).toBe('discussion-1:message-0007');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/discussion/references.test.ts`
Expected: new tests FAIL (`shortMessageRef` missing; id entries dropped).

- [ ] **Step 3: Implement in `references.ts`**

Add:

```ts
export function shortMessageRef(id?: string): string {
  const match = id?.match(/message-(\d{1,6})$/);
  return match ? `m${match[1]}` : '';
}
```

Update the entry loop inside `parseMessageReferences` — replace:

```ts
    for (const entry of list) {
      const author = typeof entry?.author === 'string' ? entry.author.trim() : '';
      const message = Number.isInteger(entry?.message) && entry.message > 0 ? entry.message : undefined;
      const resolved = message
        ? resolutionContext.find(contextMessage => contextMessage.promptNumber === message)
        : undefined;
      if (!author && !resolved) continue;
      references.push({
        ...(message && resolved ? { message } : {}),
        ...(resolved?.id ? { messageId: resolved.id } : {}),
        author: author || resolved?.agentName,
        reason: typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined
      });
    }
```

with:

```ts
    for (const entry of list) {
      const author = typeof entry?.author === 'string' ? entry.author.trim() : '';
      const message = Number.isInteger(entry?.message) && entry.message > 0 ? entry.message : undefined;
      const shortIdMatch = typeof entry?.id === 'string' ? entry.id.trim().match(/^m(\d{1,6})$/i) : null;
      const resolvedById = shortIdMatch
        ? resolutionContext.find(contextMessage => {
            const contextMatch = contextMessage.id?.match(/message-(\d{1,6})$/);
            return !!contextMatch && Number(contextMatch[1]) === Number(shortIdMatch[1]);
          })
        : undefined;
      const resolvedByNumber = message
        ? resolutionContext.find(contextMessage => contextMessage.promptNumber === message)
        : undefined;
      const resolved = resolvedById || resolvedByNumber;
      if (!author && !resolved) continue;
      references.push({
        ...(message && resolvedByNumber && resolved === resolvedByNumber ? { message } : {}),
        ...(resolved?.id ? { messageId: resolved.id } : {}),
        author: author || resolved?.agentName,
        reason: typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined
      });
    }
```

Run: `npx vitest run src/discussion/references.test.ts`
Expected: PASS.

- [ ] **Step 4: Show short ids in prompt history headers**

Write a failing test first — append to `contextCompiler.test.ts`:

```ts
  it('shows the stable short id in each history header', () => {
    const compiled = compileDiscussionContext([
      message(1, 'user'),
      message(2)
    ], '');
    expect(compiled.historyBlock).toContain('--- Message 1 [m0001]: User 1 ---');
    expect(compiled.historyBlock).toContain('--- Message 2 [m0002]: Agent 2 (Local CLI) ---');
  });
```

(The existing `message()` helper builds ids like `scope:message-0001`.)

Run: `npx vitest run src/discussion/contextCompiler.test.ts` — expect FAIL.

Then in `contextCompiler.ts` add the import:

```ts
import { shortMessageRef } from './references.js';
```

and replace `formatMessageForPromptHistory`:

```ts
function formatMessageForPromptHistory(message: PromptHistoryMessage, promptNumber: number, maxMessageTokens?: number): string {
  const refTag = shortMessageRef(message.id);
  const idPart = refTag ? ` [${refTag}]` : '';
  if (message.type === 'user') {
    const content = fitMessageContentToBudget(message.content, maxMessageTokens);
    return `--- Message ${promptNumber}${idPart}: ${message.agentName} ---\n${content}`;
  }

  const cleanedContent = cleanAgentUserContent(message.content);
  const content = fitMessageContentToBudget(isOnlyOmissionNotes(cleanedContent)
    ? '[Previous Local CLI action narration omitted.]'
    : cleanedContent, maxMessageTokens);
  return `--- Message ${promptNumber}${idPart}: ${message.agentName} (${message.providerName}) ---\n${content}`;
}
```

Run: `npx vitest run src/discussion/contextCompiler.test.ts`
Expected: PASS. (If any existing header-format assertions in this file break, update them to include the `[mNNNN]` bracket — the new format is intentional.)

- [ ] **Step 5: Update the reference protocol text**

In `utils.ts`, replace `REFERENCE_TRACING_PROTOCOL`:

```ts
export const REFERENCE_TRACING_PROTOCOL = `=== Reference Tracing Protocol ===
At the very end of your reply, append exactly one fenced code block labeled room-refs recording which prior messages you actually used:
\`\`\`room-refs
{"references": [{"id": "<the mNNNN id shown in the message header>", "author": "<agent or user name>", "reason": "<why you used it>"}]}
\`\`\`
Each history entry header shows its stable id in brackets, for example: --- Message 3 [m0007]: Architect ---. Cite that mNNNN id. If a message header shows no bracketed id, cite its visible Message number as "message": <number> instead. List only messages that genuinely shaped your answer. If you used none, output {"references": []}. Do not mention this block in your prose.`;
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/references.ts packages/engine/src/discussion/references.test.ts packages/engine/src/discussion/contextCompiler.ts packages/engine/src/discussion/contextCompiler.test.ts packages/engine/src/discussion/utils.ts
git commit -m "feat(discussion): cite stable short message ids in room-refs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Dated timestamps for discussion messages

Messages store `new Date().toLocaleTimeString()` — time only, ambiguous for multi-day discussions and in workspace-memory summaries.

**Files:**
- Modify: `packages/engine/src/discussion/discussionRunner.ts` (all `toLocaleTimeString()` occurrences)
- Modify: `packages/engine/src/discussion/moderatorRunner.ts` (the `toLocaleTimeString()` occurrence at message creation, line ~135)

**Interfaces:**
- Consumes/produces: none — `DiscussionMessage.timestamp` is already a free-form string; the desktop renderer displays it verbatim.

- [ ] **Step 1: Replace all occurrences**

Run `grep -n "toLocaleTimeString" packages/engine/src/discussion/*.ts` and replace every `new Date().toLocaleTimeString()` in `discussionRunner.ts` and `moderatorRunner.ts` with:

```ts
new Date().toLocaleString()
```

(Do not touch `taskRunner.ts` in this task unless grep shows it there too — if it does, replace those as well for consistency.)

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/discussion/discussionRunner.ts packages/engine/src/discussion/moderatorRunner.ts
git commit -m "fix(discussion): include the date in message timestamps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Token-budget the injected skills context

Active skills are injected **in full** into every agent turn's system prompt (`discussionRunner.ts:224-237`), so a large skill file multiplies across agents × rounds. Extract the injection loop into a budgeted helper. (Skill *matching* stays unchanged — matching costs no tokens; only injection size matters.)

**Files:**
- Modify: `packages/engine/src/discussion/contextBuilder.ts` (add `buildSkillsContext`)
- Modify: `packages/engine/src/discussion/discussionRunner.ts:224-237`
- Test: `packages/engine/src/discussion/contextBuilder.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveSkillPath` (already in `contextBuilder.ts`), `parseSkillFrontmatter` from `../skills/parser.js` (already imported), `trimTextToTokenBudget` from `./tokenBudget.js` (imported in Task 7).
- Produces:

```ts
export async function buildSkillsContext(
  dirPath: string,
  skillFiles: string[],
  maxTokensPerSkill = 1500
): Promise<string>;  // '' when no skills load; otherwise starts with '\n\n=== Active Skills ===\n'
```

- [ ] **Step 1: Write the failing test**

Append to `contextBuilder.test.ts`:

```ts
import { buildSkillsContext } from './contextBuilder.js';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: new tests FAIL — `buildSkillsContext` not exported.

- [ ] **Step 3: Implement `buildSkillsContext`**

Add to `contextBuilder.ts` (near `autoMatchSkills`/`resolveSkillPath`):

```ts
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
    } catch (err: any) {
      console.error(`Error loading skill ${skillFile}:`, err.message);
    }
  }
  if (sections.length === 0) return '';
  return `\n\n=== Active Skills ===\n\n${sections.join('\n\n')}\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/discussion/contextBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the discussion runner**

In `discussionRunner.ts`, replace the injection loop (lines 224-237):

```ts
      let skillsContext = '';
      if (allSkillFiles.length > 0) {
        skillsContext = '\n\n=== Active Skills ===\n';
        for (const skillFile of allSkillFiles) {
          try {
            const resolvedSkillPath = await resolveSkillPath(dirPath, skillFile);
            const skillContent = await fs.readFile(resolvedSkillPath, 'utf-8');
            const parsed = parseSkillFrontmatter(skillContent);
            skillsContext += `\n[Skill: ${skillFile}]\n${parsed.content.trim()}\n`;
          } catch (err: any) {
            console.error(`Error loading skill ${skillFile}:`, err.message);
          }
        }
      }
```

with:

```ts
      const skillsContext = await buildSkillsContext(dirPath, allSkillFiles);
```

Add `buildSkillsContext` to the import from `./contextBuilder.js`. Remove `resolveSkillPath` from that import and `parseSkillFrontmatter` from the `../skills/parser.js` import **only if** they become unused in `discussionRunner.ts` (check with `tsc` via the build).

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/contextBuilder.ts packages/engine/src/discussion/contextBuilder.test.ts packages/engine/src/discussion/discussionRunner.ts
git commit -m "feat(discussion): budget injected skill content per turn

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] Run the complete suite and build: `npm run build:engine && npm test -w packages/engine` — all PASS.
- [ ] Manual smoke test: start a discussion from the desktop app (or engine CLI) with 3+ members and enough rounds to force omission; confirm in the new `.room/discussions/discussion-*.json` that later messages show `summaryUsed: true`, that a `discussion-*.context-summary.json` file appears, and that a `SKIP:` reply is stored as a one-line `[<name> skipped this turn: ...]` message.
- [ ] Note for the desktop renderer (out of scope here): new event types `agent_skipped`, `context_summary_generated`, `context_summary_reused`, `context_summary_failed` flow through `onEvent`. Unknown event types should be ignored by existing UI code; surfacing them (e.g., a toast on `context_summary_failed`) is a follow-up UI task.
