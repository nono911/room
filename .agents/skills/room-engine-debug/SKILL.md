---
name: room-engine-debug
description: Instructions for running, testing, and debugging the ROOM core engine components, CLI, and providers.
---

# ROOM Engine Debugging and Testing Guide

Use this skill when developing, refactoring, or troubleshooting logic inside `packages/engine/`.

## 1. Local Testing with Vitest
We use Vitest to run engine unit/integration tests:

- **Run all engine tests**:
  ```bash
  rtk npm run test -w packages/engine
  ```
- **Filter tests by name/pattern**:
  ```bash
  rtk npx vitest run packages/engine/src/discussion
  ```

---

## 2. CLI Execution & Validation
The engine CLI entry point is defined in `packages/engine/bin/` and compiles to `packages/engine/dist/bin/room.js`.

- Before testing the CLI, compile the engine:
  ```bash
  rtk npm run build:engine
  ```
- Run the local CLI command directly:
  ```bash
  node packages/engine/dist/bin/room.js --help
  ```

---

## 3. Fast Agent Test Loop
There is a root-level helper script `test-agent.js` configured for fast, manual tests of the agent discussion engine.

- To run a mock agent execution or verify providers are functional:
  ```bash
  node test-agent.js
  ```
- Inspect output logs or generated files in `.room/` to check for unexpected behavior.
