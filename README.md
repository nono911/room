<p align="center">
  <img src="packages/desktop/renderer/public/room-icon.png" alt="ROOM app icon" width="120" />
</p>

# ROOM

Every project deserves its own room and its own AI team.

ROOM is a collaborative workspace where humans and AI specialists work together around shared context, discussions, tasks, documents, and decisions. It is built as a TypeScript monorepo with an Electron desktop app and a reusable CLI engine.

The main workflow is local-first: open any project workspace, initialize `.room/`, add AI members from reusable roles or custom persona instructions, then let them discuss ideas, plans, scripts, research questions, implementation work, and decisions against the shared workspace context.

## Open Source, Open Design

ROOM is intended to be open-source and open-design.

That means the code, workspace structure, role model, AI member behavior, and product direction should be understandable, inspectable, and shaped in public. The goal is not just to publish source code, but to make the design of human-AI collaboration itself open for critique, adaptation, and reuse.

ROOM should be easy to fork for different domains: software, film, research, education, business planning, writing, or any project that benefits from shared context and a purpose-built AI team.

## Project Status

ROOM is in early active development. The core desktop workflow works, but APIs, workspace file formats, packaged builds, and role templates may still change as the product matures.

Use it today if you are comfortable with local-first tools and occasional rough edges. Treat `.room/` as workspace data that should be reviewed before committing to another repository.

## How ROOM Works

ROOM treats a project folder as a shared working room. The source files stay where they are, while ROOM keeps collaboration memory in a local `.room/` directory next to the project.

The basic loop is:

```text
Workspace files + .room memory
  -> selected context
  -> AI members with role instructions
  -> discussion or task workflow
  -> saved transcript, structured state, decisions, summaries, and artifacts
```

ROOM does not rely on one giant chat forever. It separates persistent memory from prompt context:

- Raw logs are saved on disk under `.room/discussions/` and `.room/tasks/`.
- Workspace context is kept in `.room/context/` and refreshed by the repository scanner.
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
- `.room/` workspace memory for context, tasks, discussions, documents, roles, AI members, MCP config, and workspace settings.
- Workspace file browser for previewing files inside the selected workspace.
- Multi-agent Discussions with near-realtime sequential streaming.
- Chat history for saved discussions, with support for continuing an existing chat or starting a new one.
- Context Picker for sending workspace overview, structure, files, documents, tasks, or previous discussions into a run.
- Context compiler that preserves the current topic and recent messages while capping prompt history for long local CLI runs.
- Lazy rolling summary cache for omitted discussion/task messages when a non-local summarizer is available.
- Review loop mode where reviewer-style agents keep findings open until they can approve with `[APPROVED]`.
- Quality Gate mode where a moderator-style AI member can decide whether a discussion passes or needs another focused round.
- Task Run workflow for assigning real work to a Doer, sending it through Reviewer/Lead approval, and looping back when changes are required.
- Task artifacts saved separately from transcripts, so the final deliverable is easy to find without reading the full chat log.
- AI member templates and team presets for software, film/story, research, writing, business planning, and design work.
- API key settings for Gemini, Claude/Anthropic, and OpenAI-compatible model discovery.
- Local CLI provider support with safe mode by default and explicit dangerous permission opt-in.
- Repository scanner that updates `.room/context/overview.md`, `.room/context/structure.md`, and `.room/context/project-map.json`.
- Context, Documents, Tasks, Discussions, Roles, and AI Members screens in the desktop app.
- Per-workspace MCP server configuration for stdio-based MCP tools.

## Repository Structure

```text
packages/
  desktop/                 Electron main process + React renderer
    main/                  IPC handlers, scan/discussion orchestration
    renderer/              Vite React UI
  engine/                  Core ROOM engine and CLI
    src/providers/         API and local CLI providers
    src/discussion/        Multi-agent discussion/review loop
    src/scanner/           Repository scanner
    src/cli.ts             CLI entrypoint
.room/                     ROOM memory for this repository
```

## Install

```bash
npm run install:all
```

Requires Node.js 18+.

## Run the Desktop App

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

## Desktop Usage

1. Open ROOM and choose a workspace folder.
2. If the folder has no `.room/`, click `Initialize .room/ directory`.
3. Click `Scan Repository` to update workspace context when the workspace is a codebase.
4. Go to `AI Members` to add specialists from role templates or custom instructions.
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
- `Context Picker`: attach workspace context, files, docs, tasks, or previous discussion transcripts.
- `Resolve over rounds`: keep cycling through selected AI members for plan/review workflows.
- `Quality Gate`: ask a moderator-style member to decide whether another focused discussion round is needed.
- `Summarize Chat`: save a durable memory artifact into `.room/documents/`.

Discussion logs are saved under `.room/discussions/` as both machine-readable JSON and readable Markdown.

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

- `.room/tasks/task-xxxx.md`: full transcript and status summary.
- `.room/tasks/task-xxxx.json`: structured run state.
- `.room/documents/task-xxxx-artifact.md`: the final work artifact or implementation report.

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

For Local CLI AI members, `Model Name` can be left on `Default CLI Model`. ROOM will then omit the model override and let the selected CLI use its own configured default. Choose a listed model or `Custom Model...` only when you want ROOM to pass an explicit model name.

## Security Notes

ROOM is local-first, but it can still run powerful tools:

- Local CLI agents may execute commands, inspect files, or modify a workspace depending on the selected CLI and permission mode.
- Custom Local CLI commands are treated as dangerous because they are arbitrary command execution.
- MCP servers are local processes configured by the workspace and should be reviewed before use.
- Do not store API keys, credentials, or private machine-specific secrets in committed `.room/` files.
- Review `.room/config.json`, `.room/mcp.json`, and `.room/members/` before sharing a workspace.

## CLI Usage

Build the engine first:

```bash
npm run build:engine
```

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

Create a legacy ADR:

```bash
node packages/engine/dist/bin/room.js adr new "Use Electron for the desktop workspace" --path .
```

## `.room/` Workspace Structure

ROOM stores workspace-specific context under `.room/`:

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
.room/
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
  roles/
  skills/
  members/
  config.json
  mcp.json
```

Important files:

- `.room/context/overview.md`: workspace overview shown in `Context`.
- `.room/context/structure.md`: workspace structure and source-of-truth notes.
- `.room/tasks/`: task transcripts, structured task state, and follow-up task notes.
- `.room/discussions/`: discussion logs generated by AI members.
- `.room/**/*.context-summary.json`: cached summaries of omitted context used to keep long workflows compact.
- `.room/documents/`: working docs, summaries, and final task artifacts.
- `.room/roles/`: reusable role templates and legacy skill files.
- `.room/skills/`: reusable skill instructions used by AI members.
- `.room/members/`: saved AI member profiles, prompts, providers, and models.
- `.room/config.json`: scanner agent, model, and permission settings.
- `.room/mcp.json`: MCP server definitions.

## Configuration Examples

`.room/config.json`:

```json
{
  "mainAgent": "claude",
  "modelName": "claude-3-5-sonnet",
  "allowDangerousCli": false
}
```

`.room/mcp.json`:

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
- Build desktop changes with `npm run build:desktop`.
- Package the desktop app with `npm run package:desktop`.
- Keep generated desktop artifacts such as `packages/desktop/dist/` and `packages/desktop/dist-packaged/` out of review context unless packaging is the task.
- For agent review flows, prefer reviewer agents that clearly report `OPEN_FINDINGS`, `RESOLVED_FINDINGS`, `REQUIRED_CHANGES`, and `APPROVAL_STATUS`.

## Contributing

Contributions are welcome while the project shape is still forming.

Before opening a pull request:

1. Keep changes focused and explain the workflow or bug they improve.
2. Run the relevant build command:
   - `npm run build:engine` for engine or CLI changes.
   - `npm run build:desktop` for Electron, renderer, or desktop workflow changes.
3. Include screenshots or recordings for UI changes when possible.
4. Call out changes that affect `.room/` file formats, Local CLI execution, MCP behavior, or dangerous permissions.

## Roadmap

- Better first-run onboarding and example workspaces.
- More durable tests around provider execution, discussion loops, task runs, and workspace file handling.
- Stronger markdown/document rendering for saved discussions, summaries, and task artifacts.
- Improved Local CLI model detection and provider-specific execution policies.
- Cross-platform packaging and release automation.
- Clearer plugin, skill, and MCP extension patterns.

## License

ROOM is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
