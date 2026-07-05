# Read-Only Tools for CLI Discussion Agents — Design

**Status:** Approved (2026-07-05)
**Scope:** Phase 1 — Local CLI agents in discussions. API-provider tool loop is Phase 2 (separate spec).

## Problem

ROOM discussion agents are text-in/text-out: they see only what `contextBuilder` puts in the prompt. When a discussion needs facts from the workspace (or the web), agents guess and hallucinate paths/behavior. Meanwhile most of the plumbing already exists:

- `.room/mcp.json` config + MCP Servers UI tab + validation (`config-store.ts`), and `LocalCliProvider` already publishes it to `.mcp.json` for Claude CLI on every run (`localCli.ts:95-140`).
- Every CLI preset already runs sandboxed in safe mode (`localCli.ts:191-250`).
- Tool-use narration is already stripped from stored history (`isToolNarrationLine`, `cleanAgentUserContent`).

The actual blocker is ROOM's own `LOCAL_CLI_OUTPUT_POLICY`, which forbids CLI agents from inspecting the workspace, plus the absence of a user-facing switch.

## Decisions (from brainstorming)

1. **CLI agents first, API providers later.** Phase 1 unlocks Local CLI agents (Claude/Gemini/Codex/Copilot/Codewhale/Agy presets); Phase 2 adds a native tool-use loop for API providers.
2. **Capabilities: workspace read + web search.** Read/list/grep inside the workspace, plus web search where the CLI supports it. No writes, no state-changing commands.
3. **Enablement: per-discussion toggle.** A "Read-only tools" checkbox in the Discussions settings row (next to "Resolve over rounds"), default **off**.

## Architecture — four layers

### 1. Engine option

`DiscussionRunOptions.allowReadOnlyTools?: boolean` (default false → today's behavior, bit-for-bit). Flows renderer → IPC contract → `main/ipc/discussions.ts` → `engine.runDiscussion` → `runDiscussionLoop`.

### 2. Prompt policy swap

In `runDiscussionLoop`, when `allowReadOnlyTools` is on AND the agent is Local CLI AND `agent.permissionMode !== 'dangerous'`:

- Suppress `LOCAL_CLI_OUTPUT_POLICY` (the "do not inspect the workspace" policy) and inject the new `LOCAL_CLI_READ_TOOLS_POLICY` instead:
  - MAY read files, list directories, search file contents inside the active workspace, and search the web when it materially improves the answer.
  - MUST NOT create/modify/delete files, change configuration, or run state-changing commands.
  - MUST NOT narrate tool use ("I will read...", tool logs) — return only the final answer, citing real workspace paths.
- Dangerous-mode agents keep current behavior (they already have broader access by explicit user choice).
- All other prompt sections (discussion protocol, reference tracing, skills, workspace boundary) unchanged.

Mechanism: `composeAgentSystemPrompt(basePrompt, localCliAgent, ...sections)` keeps its signature. The runner passes `localCliAgent: false` for tools-enabled agents and appends `LOCAL_CLI_READ_TOOLS_POLICY` as a section — zero churn at the other 4 call sites.

### 3. CLI flag enforcement (defense in depth)

New `ProviderExecuteOptions.toolAccess?: 'none' | 'read-only'` (default `'none'`). `LocalCliProvider` maps it per preset, only when `permissionMode === 'safe'`:

| Preset | `toolAccess: 'read-only'` behavior |
|---|---|
| claude | append `--allowedTools <list>`: `Read,Grep,Glob,LS,WebSearch,WebFetch` + one `mcp__<serverName>` entry per server in `.room/mcp.json` (config is already read nearby for the `.mcp.json` publish). Unlisted tools (Edit/Write/Bash) are denied in `-p` mode. |
| codex | `--sandbox read-only` instead of `workspace-write` |
| gemini | no flag change — safe default already rejects mutating tools non-interactively; read tools and web search are auto-allowed |
| copilot / codewhale / agy / custom command | no flag change Phase 1 — prompt policy only |

`toolAccess: 'none'` (or absent) → args identical to today.

MCP caveat: ROOM cannot guarantee an arbitrary MCP server is read-only; that responsibility is the user's when they configure servers. The MCP Servers screen copy states this.

### 4. UI toggle

Checkbox **"Read-only tools"** in `DiscussionsScreen` settings row, state in `useDiscussion` (`discussionAllowReadOnlyTools`, default false), disabled while `loading`, sent as `allowReadOnlyTools` in `runDiscussion` options — mirroring the `reviewMode` pattern (`useDiscussion.ts:496`, `contract.ts:40`, `discussions.ts:134,158`). Tooltip/label copy: "Let safe-mode CLI members read workspace files and search the web this discussion."

Also: one sentence added to the MCP Servers screen: configured servers become available to CLI members when a discussion enables read-only tools; server safety is the operator's choice.

## Out of scope (Phase 1)

- API providers (Anthropic/OpenAI-compatible/Gemini API) tool loop and engine-side MCP client — Phase 2.
- Coding tasks (`taskRunner`) — unchanged.
- Per-agent tool overrides in `AgentConfig`.
- Surfacing per-tool-call activity in the UI feed (narration remains stripped; token budget protected).

## Testing

- `localCli` unit tests: per-preset args with `toolAccess: 'read-only'` vs `'none'` vs dangerous mode (flag present/absent/replaced).
- `utils` test: `LOCAL_CLI_READ_TOOLS_POLICY` injected and `LOCAL_CLI_OUTPUT_POLICY` suppressed under the right conditions (via `composeAgentSystemPrompt` composition in runner-level test).
- `engine` test: `runDiscussion(..., { allowReadOnlyTools: true })` reaches `provider.execute` with `options.toolAccess === 'read-only'` for a safe Local CLI agent, and stays `'none'`/absent when toggle off or agent dangerous.
- Existing suites (engine 152+, desktop 12+) stay green.

## Risks accepted

- **Prompt injection via web content:** mitigated by flag-level read-only enforcement — a hijacked agent still cannot write or execute state changes. Residual risk: exfiltration via subsequent web fetches; accepted for a local, single-operator tool with the toggle default-off.
- **Slower turns:** tool calls lengthen agent turns; existing provider timeouts apply. Revisit budgets if real usage hits timeouts.
- **MCP servers are trust-on-configure:** stated in UI copy.
