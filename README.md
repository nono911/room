<p align="center">
  <img src="packages/desktop/renderer/public/room-icon.png" alt="ROOM app icon" width="120" />
</p>

# ROOM

Every project deserves its own room and its own AI team.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/platform-Electron-9cf.svg" alt="Platform: Electron" />
  <a href="#contributing"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
</p>

<!-- TODO: Add a screenshot or short GIF of the desktop app here. A single image of the Discussions screen is the highest-impact thing this README can show. -->

ROOM is a collaborative workspace where humans and AI specialists work together around shared context, discussions, tasks, documents, and decisions. It is built as a TypeScript monorepo with an Electron desktop app and a reusable CLI engine.

The main workflow is local-first: create a workspace in `~/.room`, attach a source folder, add AI members from reusable roles or custom persona instructions, then let them discuss ideas, plans, scripts, research questions, implementation work, and decisions against shared workspace context.

## Open Source, Open Design

ROOM is intended to be open-source and open-design.

That means the code, workspace structure, role model, AI member behavior, and product direction should be understandable, inspectable, and shaped in public. The goal is not just to publish source code, but to make the design of human-AI collaboration itself open for critique, adaptation, and reuse.

ROOM should be easy to fork for different domains: software, film, research, education, business planning, writing, or any project that benefits from shared context and a purpose-built AI team.

## Project Status

ROOM is in early active development. The core desktop workflow works, but APIs, workspace file formats, packaged builds, and role templates may still change as the product matures.

Use it today if you are comfortable with local-first tools and occasional rough edges. ROOM data is machine-local under `~/.room`; attached source repositories remain free of ROOM-managed files.

## What Changed Recently

ROOM has moved from a simple "saved AI members plus chat" prototype toward a fuller team workspace:

- AI Members are now organized around teams. You can start from recommended team recipes, inspect and edit generated members before saving, create custom teams, reorder members, and add existing or newly generated members to a team.
- Discussions can select teams, saved members, legacy agent names, and temporary cloned members while preserving the mixed participant order across reloads and continued chats.
- AI members now have stable ids behind the scenes, so renames and team membership changes are less fragile than filename/name-only references.
- Long discussion and task runs now use stronger context budgeting, stable message ids, reference tracing, skip turns, approval tracking, and reusable context-summary sidecars.
- Safe-mode Local CLI discussion members can opt into `Read-only tools` per discussion. ROOM swaps the prompt policy and enforces CLI flags so Claude gets built-in read/web tools only and Codex runs with a read-only sandbox.
- The desktop app has broader test coverage around team creation, discussion selection, IPC behavior, workspace lifecycle, and renderer integration.

## Quick Start

Requires Node.js 18+ and npm. Packaging currently targets macOS (arm64); development mode works anywhere Electron runs.

```bash
git clone https://github.com/nono911/room.git
cd room
npm run install:all
npm run dev:desktop
```

Then create a ROOM workspace, attach a source folder, create or choose an AI team, and start a discussion. Existing `<source>/.room` workspaces can be imported without deleting or modifying the legacy data. AI providers (built-in Gemini/Claude/OpenAI plus any OpenAI-compatible endpoint) are configured in `Settings`; Local CLI members such as `claude`, `codex`, or `gemini` work without API keys if the CLI is installed and authenticated on your machine.

## How ROOM Works

ROOM owns workspaces and workspaces attach sources. Source files stay where they are, while ROOM keeps collaboration memory under `~/.room/workspaces/<workspace-id>/`.

The basic loop is:

```text
Attached source files + ROOM Home memory
  -> selected context
  -> AI members with role instructions
  -> discussion or task workflow
  -> saved transcript, structured state, decisions, summaries, and artifacts
```

ROOM does not rely on one giant chat forever. It separates persistent memory from prompt context:

- Raw logs are saved in the workspace's `discussions/` and `tasks/` directories under ROOM Home.
- Workspace context is kept in the workspace's `context/` directory and refreshed by the repository scanner.
- AI members have provider settings, model choices, persona prompts, and optional skills.
- Each agent turn receives a compiled context window instead of blindly replaying every prior message.
- Older omitted messages can be summarized into a sidecar cache and reused in later turns when a non-local summarizer is available.

This makes ROOM local-first and inspectable while keeping long discussions and review loops from growing without limit. The full record remains available on disk, but the prompt sent to an AI member is a smaller working view: project context, durable summary when available, current task or topic, and the most recent relevant messages.

## Who ROOM Is For

ROOM is useful when a project needs shared context and multiple perspectives over time:

- Solo builders who want a repeatable AI team for planning, implementation, and review.
- Software teams that want local context, task runs, and reviewer-style agents around a codebase.
- Writers, filmmakers, and creative teams that need story, production, editorial, and research roles.
- Researchers and operators who want durable discussion logs, summaries, and decision artifacts.
- Anyone experimenting with human-AI collaboration patterns that should be inspectable and forkable.

## Features

- Desktop workspace UI built with Electron, React, and Vite.
- `~/.room/workspaces/<workspace-id>/` memory for context, tasks, discussions, documents, roles, AI members, MCP config, and workspace settings.
- Workspace file browser for previewing files inside the selected workspace.
- Team-first AI member management: recommended team recipes, custom teams, member generation, reorderable team membership, and stable member ids.
- Multi-agent Discussions with near-realtime sequential streaming.
- Discussion participant selection from teams, saved members, legacy agent names, and temporary cloned members, with mixed ordering preserved.
- Chat history for saved discussions, with support for continuing an existing chat or starting a new one.
- Context Picker for sending workspace overview, structure, files, documents, tasks, or previous discussions into a run.
- Context compiler that preserves the current topic and recent messages while capping prompt history for long local CLI runs.
- Lazy rolling summary cache for omitted discussion/task messages when a non-local summarizer is available.
- Review loop mode where reviewer-style agents keep findings open until they can approve with `APPROVAL_STATUS: APPROVED`.
- Quality Gate mode where a moderator-style AI member can decide whether a discussion passes or needs another focused round, and can record agreed outcomes as task cards and ADRs.
- Stable message IDs and reference tracing: each AI member records which prior messages shaped its answer, resolved against the exact prompt it saw.
- Append-only workspace event log (`events.jsonl`) recording message, reference, task, ADR, and artifact creation for provenance and future analytics.
- Task Run workflow for assigning real work to a Doer, sending it through Reviewer/Lead approval, and looping back when changes are required.
- Task artifacts saved separately from transcripts, so the final deliverable is easy to find without reading the full chat log.
- AI member templates and team presets for software, film/story, research, writing, business planning, and design work.
- Provider registry: built-in Gemini / Claude (Anthropic) / OpenAI plus any OpenAI-compatible endpoint (Groq, OpenRouter, Mistral, DeepSeek, xAI, Together, Ollama, LM Studio, or custom base URLs) with per-provider keys, model discovery, and connection tests.
- Local CLI provider support with safe mode by default and explicit dangerous permission opt-in.
- Per-discussion `Read-only tools` mode for safe Local CLI members, including prompt-policy switching and CLI-level read-only enforcement for supported presets.
- Repository scanner that updates the workspace's `context/overview.md`, `context/structure.md`, and `context/project-map.json` in ROOM Home.
- Context, Documents, Tasks, Discussions, Roles, and AI Members screens in the desktop app.
- Per-workspace MCP server configuration for stdio-based MCP tools.

## Repository Structure

```text
packages/
  desktop/                 Electron main process + React renderer
    main/                  Electron shell plus feature-oriented IPC handlers
      ipc/                 Workspace, discussion, task, provider, MCP, file, and config IPC modules
    renderer/              Vite React UI
      src/app/             App shell, workspace routes, and cross-feature hooks
      src/features/        Feature modules such as discussions, task-run, AI members, providers, MCP, workspace files
      src/shared/          Shared UI components, hooks, IPC client, static data, and pure helpers
  engine/                  Core ROOM engine and CLI
    src/providers/         API and local CLI providers
    src/discussion/        Multi-agent discussion/review loop, context compiler, task board
    src/decisions/         ADR creation
    src/events/            Append-only workspace event log
    src/impact/            Feature impact analysis
    src/scanner.ts         Repository scanner
    src/cli.ts             CLI entrypoint
~/.room/workspaces/<id>/   ROOM memory outside attached repositories
```

## Architecture

ROOM is moving toward a feature-based desktop architecture. The renderer keeps the app shell thin and places feature state, screens, and workflow handlers near the feature that owns them.

Current renderer boundaries:

- `packages/desktop/renderer/src/app/`: application shell, workspace lifecycle, workspace data hydration, route composition, setup guidance, and theme/style injection.
- `packages/desktop/renderer/src/app/components/WorkspaceRoutes.tsx`: maps workspace tabs to feature screens. New tabs should usually be registered here, not directly inside `App.tsx`.
- `packages/desktop/renderer/src/features/discussions/`: discussion state, streaming, and discussion UI.
- `packages/desktop/renderer/src/features/task-run/`: task run state, streaming, and task run UI.
- `packages/desktop/renderer/src/features/ai-members/`: AI member screens, team creation/editing, roster helpers, and management hook.
- `packages/desktop/renderer/src/features/providers/`: provider settings, project settings, and provider context.
- `packages/desktop/renderer/src/features/workspace-files/`: files, documents, tasks, decisions, and context screens.
- `packages/desktop/renderer/src/shared/`: reusable components, hooks, IPC client, static data, markdown rendering, and pure helpers.

Current main-process boundaries:

- `packages/desktop/main/main.ts`: Electron window, app protocol, and IPC registration only.
- `packages/desktop/main/ipc/*.ts`: feature-oriented IPC modules.
- `packages/desktop/main/ipc/provider-store.ts`: provider and API key persistence.
- `packages/desktop/main/ipc/config-store.ts`: workspace `config.json` and `mcp.json` validation/loading.
- `packages/desktop/main/ipc/team-store.ts` and `teams.ts`: workspace team persistence, membership updates, and team-with-members creation.
- `packages/desktop/main/ipc/workspace-context.ts` and `workspace-files.ts`: context search and workspace file listing helpers.

When adding a desktop feature, prefer this shape:

```text
packages/desktop/renderer/src/features/<feature>/
  components/
  use<Feature>.ts

packages/desktop/main/ipc/<feature>.ts
```

Then wire the feature through `WorkspaceRoutes` and `main/ipc/index.ts`. Avoid adding business logic back into `App.tsx`; keep it for shell layout and cross-feature orchestration only.

## Run the Desktop App

Install dependencies first with `npm run install:all` (see [Quick Start](#quick-start)).

Development mode:

```bash
npm run dev:desktop
```

Build only:

```bash
npm run build:desktop
```

Package macOS app:

```bash
npm run package:desktop
```

The packaged app is created at:

```text
packages/desktop/dist-packaged/mac-arm64/ROOM.app
```

## Run Tests

The engine package has a Vitest suite covering the context compiler, reference tracing, task board, ADR creation, and the event log:

```bash
npm test -w packages/engine
```

The desktop package has Vitest coverage for app/runtime behavior, team workflows, discussion selection, IPC adapters, and workspace hooks:

```bash
npm test -w packages/desktop
```

For desktop changes, run:

```bash
npm run typecheck -w packages/desktop
npm test -w packages/desktop
npm run build:desktop
```

## Desktop Usage

1. Open ROOM and create a workspace or choose an attached source folder.
2. ROOM creates workspace data under `~/.room`; if the source contains legacy `.room/` data, choose `Import into ROOM Home`.
3. Click `Scan Repository` to update workspace context when the workspace is a codebase.
4. Go to `AI Members` to start from a recommended team, create a custom team, or manage saved specialists.
5. Go to `Discussions` when you want AI members to think together, critique ideas, explore options, or make decisions.
6. Go to `Task Run` when you want one AI member to produce work and other AI members to review it before the run is considered done.
7. Use `Context`, `Files`, `Documents`, and `Tasks` to inspect workspace material and saved artifacts.
8. Use `MCP Servers` to add stdio MCP tools for local agent runs.
9. Use `Settings` to configure API keys, the scanner agent, model override, theme, typography, and dangerous CLI permission mode.

ROOM is not limited to coding. The same workspace can be used for software tasks, film development, research, writing, design, and business planning.

## Discussions

Use `Discussions` for collaborative thinking.

Example discussion prompt:

```text
Discuss the opening scene, character motivation, pacing risks, and what decisions we need before the next draft.
```

With multiple AI members selected, ROOM runs them sequentially. Each member sees the shared context and previous discussion history, streams its output into the UI, and the next member responds after that turn completes.

Example AI member flows:

```text
Screenwriter -> Story Editor -> Producer
Researcher -> Reviewer -> Synthesizer
Product -> UX -> Architect -> Implementer -> Reviewer
Architect -> Implementer -> Reviewer
```

Use creative roles for story, production, and content work. Use research roles for ambiguous topics. Use software roles when the workspace is a codebase.

Discussion controls:

- `Chat History`: load a saved discussion and continue it.
- `New Chat`: start a fresh thread when you want a new direction.
- `Participants`: select whole teams, individual saved members, legacy agent names, or temporary clones while preserving order.
- `Context Picker`: attach workspace context, files, docs, tasks, or previous discussion transcripts.
- `Resolve over rounds`: keep cycling through selected AI members for plan/review workflows.
- `Read-only tools`: let safe-mode Local CLI members inspect workspace files and search the web for this discussion without intentionally granting write access.
- `Quality Gate`: ask a moderator-style member to decide whether another focused discussion round is needed.
- `Summarize Chat`: save a durable memory artifact into the workspace documents store.

Discussion logs are saved under the ROOM Home workspace as both machine-readable JSON and readable Markdown. Every message gets a stable ID (`discussion-12:message-0004`), each AI member records which prior messages it actually used, and message, reference, task, ADR, and artifact creation are appended to the workspace `events.jsonl`.

For long discussions, ROOM compiles a smaller prompt context for each agent turn. It keeps the first user message as an anchor, always keeps the latest user message/current topic, keeps the latest messages in full, and records how many older messages were omitted. When enough omitted context accumulates and a non-local summary-capable member is available, ROOM can save a compact `.context-summary.json` sidecar and reuse it in later prompts.

## Task Run

Use `Task Run` when you want work produced, reviewed, and saved.

The flow is:

```text
Task -> Doer -> Reviewers / Leads -> approve or send back -> artifact
```

1. Choose `Task Type`.
2. ROOM auto-matches a likely `Doer` and `Reviewers / Leads` from the workspace AI members.
3. Write the task.
4. Select relevant context.
5. Choose review cycles.
6. Click `Run Doer -> Review Loop`.

Task types:

- `General`: flexible work when no domain-specific workflow fits.
- `Coding`: code changes, implementation reports, validation notes, and reviewer feedback.
- `Writing`: drafts, edits, outlines, and editorial review.
- `Film / Story`: scene drafts, story passes, character work, and producer/editor feedback.
- `Research`: research memos, assumptions, evidence gaps, and reviewer critique.
- `Business`: product, planning, positioning, and execution notes.
- `Design`: UX flows, interface states, and design review.

Task Run saves three outputs:

- `tasks/task-xxxx.md`: full transcript and status summary in ROOM Home.
- `tasks/task-xxxx.json`: structured run state.
- `documents/task-xxxx-artifact.md`: the final work artifact or implementation report.

Like discussions, task runs use compiled context windows. The Doer and Reviewer see the current task, project context, recent task history, and a cached summary of older omitted task messages when available. Current reports and reviewer feedback are not duplicated into the prompt when they already appear in the included task history.

For coding tasks, use a `Local CLI` AI member such as Codex, Claude, Gemini CLI, or another configured tool if you want the Doer to edit files directly. API-only members can still plan, draft, and review, but they do not directly modify workspace files.

## Local CLI AI Members

ROOM supports local AI CLI workflows. For a Local CLI AI member, choose one of the supported presets or provide a custom command:

- `claude`
- `gemini`
- `codex`
- `copilot`
- `codewhale`
- `agy`
- `none` for custom command mode

Local CLI AI members run in safe mode by default. Dangerous mode is gated by workspace settings and should only be enabled for trusted workspaces and trusted prompts because it can grant broader filesystem, tool, or network access depending on the CLI preset.

In Discussions, the `Read-only tools` toggle gives safe-mode Local CLI members a narrow inspection path for that run. Claude receives only built-in read/web tools (`Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`), Codex uses a read-only sandbox, and custom commands or dangerous-mode agents keep their existing behavior. MCP servers are not automatically added to the read-only allowlist because ROOM cannot prove arbitrary MCP tools are state-free.

For Local CLI AI members, `Model Name` can be left on `Default CLI Model`. ROOM will then omit the model override and let the selected CLI use its own configured default. Choose a listed model or `Custom Model...` only when you want ROOM to pass an explicit model name.

## Security Notes

ROOM is local-first, but it can still run powerful tools:

- Local CLI agents may execute commands, inspect files, or modify a workspace depending on the selected CLI and permission mode.
- `Read-only tools` reduces write risk for supported safe-mode CLI presets, but it can still expose local workspace content to the selected model or web-capable CLI.
- Custom Local CLI commands are treated as dangerous because they are arbitrary command execution.
- MCP servers are local processes configured by the workspace and should be reviewed before use.
- Do not store credentials in exported or shared workspace files. Provider keys remain in the app's private machine-local storage.
- Review workspace `config.json`, `mcp.json`, members, and teams before exporting or sharing a workspace.

## CLI Usage

Build the engine first:

```bash
npm run build:engine
```

ROOM uses `~/.room` by default. Set `ROOM_HOME` when you need an isolated or custom data location, for example `ROOM_HOME=/path/to/room-data`.

Run commands with:

```bash
node packages/engine/dist/bin/room.js <command>
```

Initialize workspace memory:

```bash
node packages/engine/dist/bin/room.js init --path .
```

Scan repository:

```bash
node packages/engine/dist/bin/room.js scan --path .
```

Run discussion loop:

```bash
node packages/engine/dist/bin/room.js review "Discuss the next draft direction" --path . --agents "Screenwriter,Story Editor" --max-rounds 6
```

Analyze feature impact:

```bash
node packages/engine/dist/bin/room.js impact "Add OAuth login" --path .
```

Create an ADR (Architecture Decision Record):

```bash
node packages/engine/dist/bin/room.js adr new "Use Electron for the desktop workspace" --path .
```

ADRs are saved under the ROOM Home workspace's `decisions/` directory with a stable `id` in their frontmatter. The Quality Gate moderator can also create ADRs and task cards directly from an approved discussion.

## ROOM Home Workspace Structure

ROOM stores workspace-specific context under `~/.room/workspaces/<workspace-id>/`:

```text
Workspace
  Room
    Context
    Tasks
    Discussions
    Documents
    Roles
    AI Members
```

On disk this is represented as:

```text
~/.room/
  workspaces/
    ws_<uuid>/
      workspace.json
      context/
        overview.md
        structure.md
        project-map.json
      tasks/
        task-xxxx.md
        task-xxxx.json
        task-xxxx.context-summary.json
      discussions/
        discussion-xxxx.md
        discussion-xxxx.json
        discussion-xxxx.context-summary.json
      documents/
        task-xxxx-artifact.md
        discussion-xxxx-summary.md
      decisions/
        ADR-001-use-electron.md
      roles/
      skills/
      members/
      teams/
      config.json
      mcp.json
      events.jsonl
```

Important files:

- `workspace.json`: stable workspace identity, attached source path, timestamps, and legacy import receipt.
- `context/`: workspace overview, structure, and scanner output.
- `tasks/` and `discussions/`: structured state, transcripts, and context summary caches.
- `documents/` and `decisions/`: working artifacts, summaries, and ADRs.
- `skills/`, `members/`, and `teams/`: workspace-scoped AI configuration.
- `events.jsonl`: append-only provenance log.
- `config.json` and `mcp.json`: workspace execution and MCP settings.

## Configuration Examples

Workspace `config.json`:

```json
{
  "mainAgent": "claude",
  "modelName": "claude-sonnet-4-6",
  "allowDangerousCli": false
}
```

Workspace `mcp.json`:

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db", "./dev.db"]
    }
  }
}
```

## Development Notes

- Build engine changes with `npm run build:engine`.
- Validate desktop changes with `npm run typecheck -w packages/desktop`, `npm test -w packages/desktop`, and `npm run build:desktop`.
- Package the desktop app with `npm run package:desktop`.
- Keep renderer feature code in `packages/desktop/renderer/src/features/<feature>/` and shared app orchestration in `packages/desktop/renderer/src/app/`.
- Register new workspace tabs in `WorkspaceRoutes` and keep feature state in a `use<Feature>` hook where practical.
- Keep Electron main-process additions in focused `packages/desktop/main/ipc/<feature>.ts` modules and export registration through `main/ipc/index.ts`.
- Keep generated desktop artifacts such as `packages/desktop/dist/` and `packages/desktop/dist-packaged/` out of review context unless packaging is the task.
- For agent review flows, prefer reviewer agents that clearly report `OPEN_FINDINGS`, `RESOLVED_FINDINGS`, `REQUIRED_CHANGES`, and `APPROVAL_STATUS`.

## Contributing

Contributions are welcome while the project shape is still forming.

Before opening a pull request:

1. Keep changes focused and explain the workflow or bug they improve.
2. Run the relevant checks:
   - `npm run build:engine` and `npm test -w packages/engine` for engine or CLI changes.
   - `npm run build:desktop` for Electron, renderer, or desktop workflow changes.
3. Add or update tests next to the code you change in `packages/engine/src/` (`*.test.ts`, Vitest).
4. Include screenshots or recordings for UI changes when possible.
5. Call out changes that affect ROOM Home workspace formats, legacy `.room/` import compatibility, the `events.jsonl` schema, Local CLI execution, MCP behavior, or dangerous permissions.

Use Conventional Commits (`feat(engine): ...`, `fix(desktop): ...`). See [AGENTS.md](AGENTS.md) for repository conventions, coding style, and structure notes.

## Roadmap

- Better first-run onboarding and example workspaces.
- Knowledge graph and trace views derived from each workspace's `events.jsonl` provenance log.
- More provider execution tests and smoke coverage for packaged desktop builds.
- Stronger markdown/document rendering for saved discussions, summaries, and task artifacts.
- Richer Local CLI model detection, provider-specific execution policies, and future explicit allowlists for safe MCP tools.
- Cross-platform packaging and release automation.
- Clearer plugin, skill, and MCP extension patterns.

## License

ROOM is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
