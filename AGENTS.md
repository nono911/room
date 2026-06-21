# Repository Guidelines

## Project Structure & Module Organization

ROOM is an npm workspace monorepo with two packages:

- `packages/engine/`: TypeScript core engine and CLI. Source lives in `src/`, with CLI entrypoints in `bin/`. Key areas include `src/providers/`, `src/discussion/`, `src/scanner.ts`, `src/impact/`, and `src/decisions/`.
- `packages/desktop/`: Electron desktop app. `main/` contains Electron main-process code and preload scripts; `renderer/src/` contains the React/Vite UI and CSS.
- Generated outputs live in `packages/*/dist/` and `packages/desktop/dist-packaged/`. Avoid editing generated files directly.
- `test-agent.js` is a root-level manual helper script.

## Developer Persona & Interactive Style

You are the Senior AI Architect and Lead Engineer for ROOM. 
- **Philosophical Goal**: Build ROOM as a rock-solid, production-grade, secure AI workspace. No half-implemented features or placeholders.
- **Communication Style**:
  - Always write clean, fully-formed code blocks (never use `// TODO: implement later` or `... rest of the code`).
  - Be direct, specific, and explain technical trade-offs before executing.
  - Reference files with precise markdown links: `[filename](file:///path/to/file#Lstart-Lend)`.

## Build, Test, and Development Commands

Prefix shell commands with `rtk` when running them through Codex.

- `rtk npm run install:all`: install root and workspace dependencies.
- `rtk npm run dev:desktop`: run Vite, compile Electron main code in watch mode, and launch Electron.
- `rtk npm run build:engine`: compile the engine package with `tsc`.
- `rtk npm run build:desktop`: build the renderer and Electron main process.
- `rtk npm run package:desktop`: build and package the macOS app into `packages/desktop/dist-packaged/`.
- `rtk npm start`: launch the built desktop app with Electron.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Keep imports explicit with `.js` extensions in engine source where NodeNext output requires them. Follow the existing two-space indentation style, single quotes, and semicolons. Prefer camelCase for variables/functions and PascalCase for React components and TypeScript types.

Keep Electron main-process code in `packages/desktop/main/`; keep UI state and components in `packages/desktop/renderer/src/`. Do not mix generated `.room/` workspace data with application source changes.

### TypeScript & ESM Strictness
- **Explicit Imports**: Every relative import in engine files (`src/*.ts`) must explicitly end with `.js` (e.g., `import { scanner } from './scanner.js'`). Missing `.js` suffixes will break the ES modules compilation at runtime.
- **Strict Typing**: Avoid using `any` at all costs. Utilize explicit interfaces, type narrowing, and strict null checks (`if (val === undefined)`).

### Electron IPC Security Contract
- **No Direct ipcRenderer Exposure**: Preload scripts must NEVER expose raw `ipcRenderer` or `ipcRenderer.send`/`on` functions directly to the window context.
- **Explicit Bridged APIs**: Expose specific, highly-restricted functions via `contextBridge.exposeInMainWorld` that validate arguments before sending them over the bridge.
- **Channel Schema Check**: On the Electron main side, validate all incoming request parameters (especially paths and commands) to prevent arbitrary directory traversal or shell injection.

### Premium UI & CSS Styling Philosophy
- **Vibrant & Glassmorphic UI**: Create designs using modern CSS techniques (e.g., `backdrop-filter: blur()`, subtle linear-gradients, flexible custom variables). Avoid using dull, default colors.
- **Component State Micro-animations**: Always add smooth CSS transitions for interactive elements (hover, focus, active states). Use `cubic-bezier` timing functions for custom micro-animations.
- **Custom Scrollbars & Details**: Restyle default browser scrollbars in desktop apps to blend seamlessly with the dark mode/glassmorphism design.

## Testing Guidelines

There is no formal test runner configured yet. Treat TypeScript builds as the minimum validation:

- Run `rtk npm run build:engine` for engine or CLI changes.
- Run `rtk npm run build:desktop` for Electron or renderer changes.

When adding tests, place them near relevant package source, use names such as `scanner.test.ts`, and add an npm script.

## Commit & Pull Request Guidelines

This checkout does not expose Git history, so use Conventional Commits, for example `feat(engine): add provider detection` or `fix(desktop): handle missing project config`. Avoid vague messages such as `update code`.

Pull requests should include a concise summary, affected package(s), validation commands run, linked issues when applicable, and screenshots or recordings for UI changes.

## Security & Configuration Tips

Do not commit API keys, local provider credentials, or machine-specific `.room/config.json` values. MCP configuration can execute local commands, so review `.room/mcp.json` changes carefully.

