<p align="center">
  <img src="packages/desktop/renderer/public/room-icon.png" alt="ROOM app icon" width="120" />
</p>

# ROOM

Your persistent room for working with an AI team.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node >= 18" />
  <img src="https://img.shields.io/badge/platform-Electron-9cf.svg" alt="Platform: Electron" />
</p>

ROOM is a local-first collaboration app for discussions, tasks, documents, decisions, reviews, context sets, AI members, and manually selected skills. A Room is the durable entity. A Source is an optional folder attached when a run needs files, search, scanning, Git, or coding tools.

The desktop app opens directly into a source-less Personal Room. You can start general work immediately and attach or detach a Source later without moving or deleting Room memory.

## Status

ROOM is in active development. Domain and API changes may still be hard cuts while the product is pre-release.

Current design rules:

- The Personal Room is created automatically under `~/.room/rooms/room_personal/`.
- ROOM data never lives inside an attached Source.
- A Room can have zero or more attached Sources and one active Source in the current UI.
- Room-only work does not require a folder.
- Source capabilities fail closed and show an Attach Source action when no Source is active.
- Installed machine skills are discoverable but remain off until selected for an individual AI member.
- Runs snapshot either Source provenance or an explicit source-less provenance record.

## Quick Start

Requires Node.js 18+ and npm. Packaging currently targets macOS arm64; development mode works wherever Electron is supported.

```bash
git clone https://github.com/nono911/room.git
cd room
npm run install:all
npm run dev:desktop
```

ROOM opens the Personal Room immediately. Add AI members and begin a general discussion or task, or choose **Attach Source folder** when you need code-aware capabilities.

## Mental Model

```text
Personal Room
  durable memory, members, skills, discussions, tasks, documents,
  decisions, reviews, context sets, settings, and run records
        |
        +-- optional Source A
        |     files, search, scan snapshot, Git, coding actions
        |
        +-- optional Source B
              files, search, scan snapshot, Git, coding actions
```

Room memory is independent of Source lifecycle. Detaching a Source removes its attachment from the Room manifest; it does not modify Source files or erase Room artifacts.

Every run receives an immutable execution location:

- `room-only`: the run has a `roomId` and no Source.
- `source`: the run has a `roomId`, `sourceId`, Source name, and canonical Source path captured at start.

Changing the active Source affects future runs only.

## Features

- Source-less Home and run composer on first launch.
- Multi-member discussion and review loops.
- Task runs with a Doer, reviewers, approval tracking, and saved artifacts.
- Documents, decisions, reviews, tasks, discussion history, and context sets owned by the Room.
- Team recipes, custom teams, stable member IDs, and editable AI member personas.
- Manual machine-skill toggles from `~/.codex/skills`, `~/.agents/skills`, and the Codex plugin cache.
- Provider registry for Gemini, Anthropic, OpenAI, OpenAI-compatible endpoints, Ollama, and LM Studio.
- Local CLI discovery for visibility, with execution disabled until ROOM has an OS-level Source boundary.
- Source file tree, search, preview, scan, Git, and coding actions when a Source is active.
- Source-scoped scan snapshots stored in Room data without overwriting Room memory.
- Stable message references, compiled context windows, summary sidecars, and run provenance.
- Electron IPC based on `roomId` and `sourceId`; the main process resolves canonical paths.

## Data Layout

All ROOM-managed state is stored under `~/.room`:

```text
~/.room/
  system/
    providers.json
  rooms/
    room_personal/
      room.json
      config.json
      mcp.json
      context/
        overview.md
        structure.md
        sets.json
      runs/
        run_<uuid>.json
      tasks/
      discussions/
      documents/
      decisions/
      reviews/
      skills/
      roles/
      members/
      teams/
      strategies/
      sources/
        source_<uuid>/
          scan/
            current.json
            generations/
              generation-<uuid>/
                overview.md
                structure.md
                project-map.json
                provenance.json
```

`room.json` is the Room manifest. Its `sources` array may be empty and `activeSourceId` is optional. Attached Source folders are referenced by stable IDs and canonical paths; ROOM never writes `.room` data into those folders.

Provider credentials are machine-global ROOM data under `~/.room/system/` and are not returned to the renderer.

## Desktop Usage

1. Open ROOM. The Personal Room and Home are ready without a Source.
2. Create or select AI members and manually toggle the Room or machine skills they need.
3. Start **Think**, **Decide**, **Execute**, or **Review** for source-less work.
4. Use **Attach Source folder** only when files or coding context are required.
5. With an active Source, browse files, search context, preview files, or run a Source scan.
6. Detach or switch Sources without changing existing Room memory or an in-flight run.
7. Inspect saved work in Tasks, Discussions, Documents, Decisions, and Reviews.

## Discussions and Tasks

Discussions are for collaborative thinking, critique, planning, and decisions. A run can select teams, saved members, and temporary API-backed participants while preserving participant order.

Task runs follow:

```text
Task -> Doer -> Reviewers -> approve or send back -> saved artifact
```

General, writing, research, business, design, and other non-coding tasks work without a Source. Coding tasks require an active Source. ROOM stores task transcripts and artifacts in the Room, not in the Source.

Long runs compile a bounded context window from:

- Room overview and structure.
- Explicitly selected Room artifacts.
- Explicitly selected files from a Source-qualified reference.
- Durable summary context when available.
- The latest relevant run messages.

Source file references include their `sourceId`, so changing the active Source cannot silently redirect an existing reference.

## Machine Skills

Agent Editor discovers skills already installed on this Mac from:

- `~/.codex/skills`
- `~/.agents/skills`
- the local Codex plugin cache

Discovery does not enable a skill. A user must toggle each skill for each AI member. ROOM stores a stable read-only reference and loads only selected `SKILL.md` content when that member runs.

Selecting a skill does not execute its scripts or broaden the member's tool permissions.

## Local CLI Policy

ROOM discovers installed Local CLIs but does not execute them in this release. CLI-level read-only or workspace-write flags do not confine reads to the active Source, and a Source path string is not a stable filesystem capability. Safe and dangerous Local CLI modes therefore fail closed until ROOM can enforce the boundary at the operating-system level.

Custom Local CLI commands and renderer-supplied temporary Local CLI members are also disabled. Configure an API or OpenAI-compatible provider for Room discussions and task runs.

## MCP Policy

MCP configuration can launch local processes, so saving it requires dangerous Room access and a native confirmation. Inline MCP environment variables are rejected; secrets must not be stored in `mcp.json`.

Example:

```json
{
  "mcpServers": {
    "local-tools": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"]
    }
  }
}
```

## Security Boundaries

- Renderer IPC sends identities and relative Source paths, never trusted absolute roots.
- The Electron main process resolves `roomId` and `sourceId`.
- Filesystem roots, traversal, Room-home overlap, and symlink escape are rejected.
- Source preview and selected-context reads use verified file handles and post-open identity checks.
- ROOM-managed writers reject symlinked storage paths.
- Attached Sources are read-only to ROOM in this release.
- Local CLI execution is disabled; API-backed runs can still use selected Source context.
- Scan output is published as immutable generations through an atomically replaced Source pointer.
- Room manifest mutations use in-process and cross-process locks.
- Provider credentials stay outside Room-shareable data.

Treat prompts, skills, MCP commands, and attached Source content as potentially untrusted. Review dangerous approvals carefully.

## CLI

Build first:

```bash
npm run build:engine
```

ROOM uses `~/.room` by default. Set `ROOM_HOME` for an isolated data root.

Create the Personal Room and attach the current directory:

```bash
node packages/engine/dist/bin/room.js init --path .
```

Scan an already attached Source:

```bash
node packages/engine/dist/bin/room.js scan --path .
```

Run a source-less discussion by omitting `--path`:

```bash
node packages/engine/dist/bin/room.js review "Compare the options" \
  --agents "Architect,Reviewer"
```

Run against an attached Source:

```bash
node packages/engine/dist/bin/room.js review "Review this implementation" \
  --path . \
  --agents "Architect,Reviewer"
```

Create a source-less ADR:

```bash
node packages/engine/dist/bin/room.js adr new "Use Electron for the desktop app"
```

Analyze impact for an attached Source:

```bash
node packages/engine/dist/bin/room.js impact "Add OAuth login" --path .
```

## Repository Structure

```text
packages/
  engine/
    src/roomHome.ts        Room manifest and Source attachment domain
    src/workspace.ts       Room/Source execution locations and safe paths
    src/runRecords.ts      Run lifecycle and provenance records
    src/scanner.ts         Source scanner and atomic Source snapshots
    src/discussion/        Discussion, task, context, and review workflows
    src/providers/         API and Local CLI providers
    src/agents/            AI member registry and execution policy
  desktop/
    main/ipc/              Validated Electron IPC and persistence
    renderer/src/app/      App shell and route composition
    renderer/src/features/ Feature-owned UI and state
    renderer/src/shared/   Shared UI and typed IPC client
```

Some internal filenames still use `Workspace` as a technical module name. In the product domain and UI, **Room** means durable collaboration state and **Source** means an optional attached folder.

## Development

Install:

```bash
npm run install:all
```

Run desktop development:

```bash
npm run dev:desktop
```

Verify:

```bash
npm test -w packages/engine
npm test -w packages/desktop
npm run typecheck -w packages/desktop
npm run build:engine
npm run build:desktop
node scripts/guard-file-size.js
```

Package macOS:

```bash
npm run package:desktop
```

Keep source `.ts` and `.tsx` files below 500 lines. Do not edit generated `dist/` or `dist-packaged/` outputs directly.

## Contributing

Keep changes focused, add regression coverage for changed behavior, and call out any changes to:

- Room manifest or run provenance schemas.
- Source containment or IPC identity boundaries.
- Local CLI, MCP, provider credential, or dangerous-access policy.
- Machine-skill discovery and manual selection.

Use Conventional Commits and include the checks run in pull request notes.

## License

ROOM is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
