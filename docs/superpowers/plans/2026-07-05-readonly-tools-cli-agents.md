# Read-Only Tools for CLI Discussion Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let safe-mode Local CLI discussion agents read workspace files and search the web, behind a per-discussion "Read-only tools" toggle (default off), per `docs/superpowers/specs/2026-07-05-readonly-tools-design.md`.

**Architecture:** Four thin layers over existing plumbing: (1) pure tool-access helpers + a `toolAccess` field on `ProviderExecuteOptions`, (2) `LocalCliProvider` maps it to per-preset CLI flags, (3) `runDiscussionLoop` swaps the Local CLI prompt policy and passes `toolAccess` when the new `allowReadOnlyTools` option is on, (4) renderer toggle → IPC → engine. Default-off preserves today's behavior bit-for-bit.

**Tech Stack:** TypeScript ESM (relative imports end in `.js`), vitest, Electron IPC.

## Global Constraints

- Only Local CLI agents with `permissionMode !== 'dangerous'` are affected; dangerous-mode agents keep current behavior (spec §2, §3).
- `toolAccess: 'none'` or absent → CLI args identical to today (spec §3).
- Claude read-only allowlist: `Read,Grep,Glob,LS,WebSearch,WebFetch` plus `mcp__<serverName>` per server in `.room/mcp.json` (spec §3).
- Codex read-only: `--sandbox read-only` replaces `workspace-write`; gemini/copilot/codewhale/agy/custom get prompt policy only (spec §3).
- UI label: **"Read-only tools"**; tooltip: "Let safe-mode CLI members read workspace files and search the web this discussion." (spec §4).
- Engine: `npm run build:engine && npm test -w packages/engine`. Desktop: `npm run build:desktop && npm test -w packages/desktop`.
- `packages/engine/dist/` is generated — never edit. Code style: 2-space indent, single quotes, semicolons.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Tool-access type and pure helpers

**Files:**
- Modify: `packages/engine/src/providers/provider.ts` (add `ToolAccess` type + options field)
- Create: `packages/engine/src/providers/toolAccess.ts`
- Test: `packages/engine/src/providers/toolAccess.test.ts` (new)

**Interfaces:**
- Consumes: `LocalCliPermissionMode` (`'safe' | 'dangerous'`) from `./localCli.js` — do NOT import it (circular risk); use the literal union inline.
- Produces (Task 2 and 3 rely on these exact names):

```ts
// provider.ts
export type ToolAccess = 'none' | 'read-only';
export interface ProviderExecuteOptions {
  onChunk?: (chunk: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  toolAccess?: ToolAccess;
}

// toolAccess.ts
export const CLAUDE_READ_ONLY_TOOLS: readonly string[];
export function resolveToolAccess(requested: ToolAccess | undefined, permissionMode: 'safe' | 'dangerous'): ToolAccess;
export function parseMcpServerNames(rawJson: string | null): string[];
export function claudeAllowedToolsArg(mcpServerNames: string[]): string;
export function applyReadOnlyToolArgs(preset: string, args: string[], mcpServerNames: string[]): string[];
```

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/src/providers/toolAccess.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  resolveToolAccess,
  parseMcpServerNames,
  claudeAllowedToolsArg,
  applyReadOnlyToolArgs
} from './toolAccess.js';

describe('resolveToolAccess', () => {
  it('grants read-only only to safe-mode agents', () => {
    expect(resolveToolAccess('read-only', 'safe')).toBe('read-only');
    expect(resolveToolAccess('read-only', 'dangerous')).toBe('none');
    expect(resolveToolAccess('none', 'safe')).toBe('none');
    expect(resolveToolAccess(undefined, 'safe')).toBe('none');
  });
});

describe('parseMcpServerNames', () => {
  it('extracts server names from mcp config json', () => {
    const raw = JSON.stringify({ mcpServers: { search: { command: 'npx' }, fs: { command: 'node' } } });
    expect(parseMcpServerNames(raw)).toEqual(['search', 'fs']);
  });

  it('returns empty for missing, invalid, or empty config', () => {
    expect(parseMcpServerNames(null)).toEqual([]);
    expect(parseMcpServerNames('not json')).toEqual([]);
    expect(parseMcpServerNames('{"mcpServers": null}')).toEqual([]);
    expect(parseMcpServerNames('{}')).toEqual([]);
  });
});

describe('claudeAllowedToolsArg', () => {
  it('joins the read-only builtins with mcp server entries', () => {
    expect(claudeAllowedToolsArg(['search']))
      .toBe('Read,Grep,Glob,LS,WebSearch,WebFetch,mcp__search');
  });

  it('is builtins-only without mcp servers', () => {
    expect(claudeAllowedToolsArg([])).toBe('Read,Grep,Glob,LS,WebSearch,WebFetch');
  });
});

describe('applyReadOnlyToolArgs', () => {
  it('appends --allowedTools for the claude preset', () => {
    expect(applyReadOnlyToolArgs('claude', ['-p', '--verbose'], []))
      .toEqual(['-p', '--verbose', '--allowedTools', 'Read,Grep,Glob,LS,WebSearch,WebFetch']);
  });

  it('swaps the codex sandbox to read-only', () => {
    expect(applyReadOnlyToolArgs('codex', ['exec', '--sandbox', 'workspace-write'], []))
      .toEqual(['exec', '--sandbox', 'read-only']);
  });

  it('leaves other presets untouched', () => {
    expect(applyReadOnlyToolArgs('gemini', ['--output-format', 'stream-json'], []))
      .toEqual(['--output-format', 'stream-json']);
    expect(applyReadOnlyToolArgs('none', ['custom'], [])).toEqual(['custom']);
  });

  it('does not mutate the input array', () => {
    const args = ['exec', '--sandbox', 'workspace-write'];
    applyReadOnlyToolArgs('codex', args, []);
    expect(args).toEqual(['exec', '--sandbox', 'workspace-write']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/engine/`): `npx vitest run src/providers/toolAccess.test.ts`
Expected: FAIL — module `./toolAccess.js` not found.

- [ ] **Step 3: Implement**

In `packages/engine/src/providers/provider.ts`, replace the existing `ProviderExecuteOptions` with:

```ts
export type ToolAccess = 'none' | 'read-only';

export interface ProviderExecuteOptions {
  onChunk?: (chunk: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  toolAccess?: ToolAccess;
}
```

Create `packages/engine/src/providers/toolAccess.ts`:

```ts
import type { ToolAccess } from './provider.js';

export const CLAUDE_READ_ONLY_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch'];

export function resolveToolAccess(
  requested: ToolAccess | undefined,
  permissionMode: 'safe' | 'dangerous'
): ToolAccess {
  return requested === 'read-only' && permissionMode === 'safe' ? 'read-only' : 'none';
}

export function parseMcpServerNames(rawJson: string | null): string[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    const servers = parsed?.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.keys(servers).filter(name => name.trim().length > 0);
  } catch {
    return [];
  }
}

export function claudeAllowedToolsArg(mcpServerNames: string[]): string {
  return [...CLAUDE_READ_ONLY_TOOLS, ...mcpServerNames.map(name => `mcp__${name}`)].join(',');
}

export function applyReadOnlyToolArgs(preset: string, args: string[], mcpServerNames: string[]): string[] {
  if (preset === 'claude') {
    return [...args, '--allowedTools', claudeAllowedToolsArg(mcpServerNames)];
  }
  if (preset === 'codex') {
    return args.map(arg => (arg === 'workspace-write' ? 'read-only' : arg));
  }
  return [...args];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/providers/toolAccess.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Build and run the engine suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: build passes; all tests PASS (the new `toolAccess` field is optional, so nothing else changes).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/providers/provider.ts packages/engine/src/providers/toolAccess.ts packages/engine/src/providers/toolAccess.test.ts
git commit -m "feat(engine): add read-only tool access helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire tool access into LocalCliProvider

**Files:**
- Modify: `packages/engine/src/providers/localCli.ts` (inside `executeInternal`, ~lines 88-275)

**Interfaces:**
- Consumes: `resolveToolAccess`, `parseMcpServerNames`, `applyReadOnlyToolArgs` from `./toolAccess.js` (Task 1); `options?.toolAccess` from `ProviderExecuteOptions`.
- Produces: no new exports. Behavior: when `execute(..., { toolAccess: 'read-only' })` is called on a safe-mode provider, claude gets `--allowedTools <list>` appended and codex gets `--sandbox read-only`; all other cases produce today's args exactly. Logic is fully covered by Task 1's unit tests; this task is thin glue verified by typecheck + existing suite.

- [ ] **Step 1: Add the import**

At the top of `packages/engine/src/providers/localCli.ts`, next to the existing `./provider.js` import, add:

```ts
import { applyReadOnlyToolArgs, parseMcpServerNames, resolveToolAccess } from './toolAccess.js';
```

- [ ] **Step 2: Resolve access and apply flags in `executeInternal`**

`executeInternal` already declares (around line 100):

```ts
      const mcpConfigPath = path.join(this.cwd, '.room', 'mcp.json');
```

Immediately BEFORE that line, add:

```ts
      const toolAccess = resolveToolAccess(options?.toolAccess, this.permissionMode);
```

Then find the end of the preset configuration `if/else` chain — the block that ends with the custom-command fallback and is followed by:

```ts
      console.log(`[Local CLI Provider] Spawning binary: ${bin} with args: ${args.join(' ')}`);
```

Immediately BEFORE that `console.log` line, add:

```ts
      if (toolAccess === 'read-only' && this.cliPreset !== 'none') {
        const mcpServerNames = this.cliPreset === 'claude'
          ? parseMcpServerNames(await fs.readFile(mcpConfigPath, 'utf-8').catch(() => null))
          : [];
        args = applyReadOnlyToolArgs(this.cliPreset, args, mcpServerNames);
      }
```

(`fs` here is the `fs/promises` namespace already imported by this file. The custom-command fallback path is excluded via the `'none'` check so user-defined commands are never altered.)

- [ ] **Step 3: Build and run the engine suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: build passes (file is on the size-guard whitelist; the ~10 added lines are acceptable); all tests PASS — `toolAccess` is never `'read-only'` unless a caller opts in, so existing behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/providers/localCli.ts
git commit -m "feat(engine): map read-only tool access to CLI preset flags

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Discussion option, prompt policy swap, and engine tests

**Files:**
- Modify: `packages/engine/src/discussion/utils.ts` (new policy constant, after `LOCAL_CLI_OUTPUT_POLICY` ~line 32)
- Modify: `packages/engine/src/discussion/discussionRunner.ts` (`DiscussionRunOptions` ~line 60, agent loop ~lines 270-295)
- Test: `packages/engine/src/discussion/engine.test.ts` (extend)

**Interfaces:**
- Consumes: `toolAccess` option on `provider.execute` (Tasks 1-2).
- Produces (Task 4 relies on the option name):
  - `DiscussionRunOptions.allowReadOnlyTools?: boolean`
  - `export const LOCAL_CLI_READ_TOOLS_POLICY: string` in `utils.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/src/discussion/engine.test.ts`, inside the `DiscussionEngine interrupt checkpoints` describe block (reuse the existing `createWorkspaceWithAgents` / `localCliAgent` helpers and `LocalCliProvider` import already present in that file):

```ts
  it('passes read-only tool access to safe local CLI agents when enabled', async () => {
    const dir = await createWorkspaceWithAgents([localCliAgent('Doer', 'Doer')]);
    const execSpy = vi.spyOn(LocalCliProvider.prototype, 'execute').mockResolvedValueOnce('Answer.');

    const engine = new DiscussionEngine(dir);
    await engine.runDiscussion('discussion-201', 'Tools on', 'Check the workspace', ['Doer'], 1, {
      allowReadOnlyTools: true
    });

    const [, systemPrompt, execOptions] = execSpy.mock.calls[0];
    expect(execOptions?.toolAccess).toBe('read-only');
    expect(systemPrompt).toContain('Read-Only Tools Policy');
    expect(systemPrompt).not.toContain('Do not inspect the workspace');
  });

  it('keeps local CLI agents tool-free by default', async () => {
    const dir = await createWorkspaceWithAgents([localCliAgent('Doer', 'Doer')]);
    const execSpy = vi.spyOn(LocalCliProvider.prototype, 'execute').mockResolvedValueOnce('Answer.');

    const engine = new DiscussionEngine(dir);
    await engine.runDiscussion('discussion-202', 'Tools off', 'Check the workspace', ['Doer'], 1, {});

    const [, systemPrompt, execOptions] = execSpy.mock.calls[0];
    expect(execOptions?.toolAccess).toBe('none');
    expect(systemPrompt).toContain('Do not inspect the workspace');
    expect(systemPrompt).not.toContain('Read-Only Tools Policy');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/discussion/engine.test.ts`
Expected: the two new tests FAIL (`execOptions?.toolAccess` is `undefined`; system prompt lacks the new policy). Existing tests PASS.

- [ ] **Step 3: Add the policy constant**

In `packages/engine/src/discussion/utils.ts`, directly after the `LOCAL_CLI_OUTPUT_POLICY` constant, add:

```ts
export const LOCAL_CLI_READ_TOOLS_POLICY = `=== Local CLI Read-Only Tools Policy ===
You may read files, list directories, and search file contents inside the active workspace, and search the web when it materially improves your answer.
Do not create, modify, or delete files, change configuration, or run commands that change any state.
Do not narrate tool use such as "I will read the file" or raw tool logs; use tools silently and return only your final answer.
Cite real workspace paths for anything you report from files.
If required context is still missing after inspection, say exactly what is missing.`;
```

- [ ] **Step 4: Wire the option through the runner**

In `packages/engine/src/discussion/discussionRunner.ts`:

1. Add `LOCAL_CLI_READ_TOOLS_POLICY` to the existing import from `./utils.js`.
2. Add to `DiscussionRunOptions` (after `temporaryAgents?: AgentConfig[];`):

```ts
  allowReadOnlyTools?: boolean;
```

3. In the agent loop, directly before the `const systemPrompt = composeAgentSystemPrompt(` call, add:

```ts
      const readOnlyToolsEnabled = !!options.allowReadOnlyTools
        && agent.provider === 'Local CLI'
        && agent.permissionMode !== 'dangerous';
```

4. Replace the `composeAgentSystemPrompt` call:

```ts
      const systemPrompt = composeAgentSystemPrompt(
        agent.systemPrompt,
        agent.provider === 'Local CLI' && !readOnlyToolsEnabled,
        readOnlyToolsEnabled ? LOCAL_CLI_READ_TOOLS_POLICY : '',
        DISCUSSION_PROTOCOL,
        hasReferableHistory ? REFERENCE_TRACING_PROTOCOL : '',
        skillsContext,
        strategyContext,
        reviewProtocol,
        compiledContext.projectContextBlock
      );
```

5. In the `provider.execute(prompt, systemPrompt, { ... })` call, add one field above `onChunk`:

```ts
          toolAccess: readOnlyToolsEnabled ? 'read-only' : 'none',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/discussion/engine.test.ts`
Expected: PASS, including both new tests.

- [ ] **Step 6: Build and run the full engine suite**

Run: `npm run build:engine && npm test -w packages/engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/utils.ts packages/engine/src/discussion/discussionRunner.ts packages/engine/src/discussion/engine.test.ts
git commit -m "feat(discussion): allow read-only tools for safe CLI agents

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Renderer toggle and IPC plumbing

**Files:**
- Modify: `packages/desktop/shared/ipc/contract.ts:40` (options type)
- Modify: `packages/desktop/main/ipc/discussions.ts:134,158` (destructure + pass)
- Modify: `packages/desktop/renderer/src/features/discussions/useDiscussion.ts` (state ~line 38, send options ~line 496, return ~line 580)
- Modify: `packages/desktop/renderer/src/app/components/WorkspaceRoutes.tsx` (props ~lines 99, 254, 355)
- Modify: `packages/desktop/renderer/src/features/discussions/components/DiscussionsScreen.tsx` (props ~lines 38, 100; settings row ~line 596)
- Modify: `packages/desktop/renderer/src/features/mcp/components/McpServersScreen.tsx:189` (empty-state copy)

**Interfaces:**
- Consumes: `DiscussionRunOptions.allowReadOnlyTools` (Task 3).
- Produces: renderer state `discussionAllowReadOnlyTools: boolean` + setter, threaded exactly like the existing `discussionReviewMode` pattern.

- [ ] **Step 1: Extend the IPC contract**

In `packages/desktop/shared/ipc/contract.ts` line 40, the `runDiscussion` options object type — add one member alongside `reviewMode?: boolean`:

```ts
allowReadOnlyTools?: boolean;
```

- [ ] **Step 2: Pass it through the main process**

In `packages/desktop/main/ipc/discussions.ts`:

- Line ~134: add `allowReadOnlyTools` to the destructuring that already contains `topic, agentNames, maxRounds, reviewMode, contextRefs, ...`.
- Line ~158: in the options object passed to `engine.runDiscussion` (where `reviewMode: !!reviewMode,` lives), add:

```ts
          allowReadOnlyTools: !!allowReadOnlyTools,
```

- [ ] **Step 3: Renderer state and send**

In `packages/desktop/renderer/src/features/discussions/useDiscussion.ts`:

1. After the `discussionQualityGate` useState (~line 38), add:

```ts
  const [discussionAllowReadOnlyTools, setDiscussionAllowReadOnlyTools] = useState<boolean>(false);
```

2. In the `api.runDiscussion(...)` options object (~line 496), after `reviewMode: discussionReviewMode,`, add:

```ts
        allowReadOnlyTools: discussionAllowReadOnlyTools,
```

3. In the hook's return object (~line 580, next to `discussionQualityGate, setDiscussionQualityGate,`), add:

```ts
    discussionAllowReadOnlyTools, setDiscussionAllowReadOnlyTools,
```

- [ ] **Step 4: Thread through WorkspaceRoutes**

In `packages/desktop/renderer/src/app/components/WorkspaceRoutes.tsx`, mirror `discussionReviewMode` at all three sites:

- Props interface (~line 99): add `discussionAllowReadOnlyTools: any; setDiscussionAllowReadOnlyTools: any;`
- Destructure (~line 254): add `discussionAllowReadOnlyTools, setDiscussionAllowReadOnlyTools,`
- `<DiscussionsScreen ...>` (~line 355): add `discussionAllowReadOnlyTools={discussionAllowReadOnlyTools} setDiscussionAllowReadOnlyTools={setDiscussionAllowReadOnlyTools}`

Check how `WorkspaceRoutes` receives the hook values (grep `discussionReviewMode` in `packages/desktop/renderer/src/app/App.tsx`) and add the two new names at the same spots there too if App.tsx forwards them explicitly.

- [ ] **Step 5: The checkbox**

In `packages/desktop/renderer/src/features/discussions/components/DiscussionsScreen.tsx`:

1. Props interface (~line 38): add

```ts
  discussionAllowReadOnlyTools: boolean;
  setDiscussionAllowReadOnlyTools: (value: boolean) => void;
```

2. Destructure (~line 100): add `discussionAllowReadOnlyTools, setDiscussionAllowReadOnlyTools,`
3. In the settings row, directly after the "Resolve over rounds" `</label>`, add:

```tsx
        <label
          title="Let safe-mode CLI members read workspace files and search the web this discussion."
          style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}
        >
          <input
            type="checkbox"
            checked={discussionAllowReadOnlyTools}
            disabled={loading}
            onChange={(e) => setDiscussionAllowReadOnlyTools(e.target.checked)}
          />
          Read-only tools
        </label>
```

- [ ] **Step 6: MCP screen copy**

In `packages/desktop/renderer/src/features/mcp/components/McpServersScreen.tsx` (~line 189), replace the empty-state text:

```tsx
              No servers configured.
```

with:

```tsx
              No servers configured. Servers added here become available to CLI members when a discussion enables read-only tools; make sure you trust what a server can do.
```

- [ ] **Step 7: Build and test the desktop package**

Run: `npm run build:desktop && npm test -w packages/desktop`
Expected: build passes; all 12+ tests PASS (toggle defaults to off, so existing App.test.tsx flows are unaffected).

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/shared/ipc/contract.ts packages/desktop/main/ipc/discussions.ts packages/desktop/renderer/src/features/discussions/useDiscussion.ts packages/desktop/renderer/src/app/components/WorkspaceRoutes.tsx packages/desktop/renderer/src/features/discussions/components/DiscussionsScreen.tsx packages/desktop/renderer/src/features/mcp/components/McpServersScreen.tsx
git commit -m "feat(desktop): add read-only tools toggle for discussions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] `npm run build:engine && npm test -w packages/engine` — all PASS.
- [ ] `npm run build:desktop && npm test -w packages/desktop` — all PASS.
- [ ] Manual smoke: open the app, start a discussion with a safe-mode Claude CLI member and "Read-only tools" ON; confirm the spawn log line (`[Local CLI Provider] Spawning binary: claude ...`) includes `--allowedTools Read,Grep,Glob,LS,WebSearch,WebFetch`, and the agent's reply cites real files without tool narration. Run once more with the toggle OFF and confirm the flag is absent.
- [ ] Confirm a dangerous-mode member's args are unchanged in both toggle states.
