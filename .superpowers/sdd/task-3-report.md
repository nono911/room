# Task 3 Report: Member Save/Delete Transition And Workspace Data

## Status

- Completed

## Changed Files

- `packages/desktop/main/ipc/agents.ts`
- `packages/desktop/main/ipc/workspace.ts`
- `packages/desktop/main/preload.js`
- `packages/desktop/renderer/src/shared/ipc/client.ts`
- `packages/desktop/renderer/src/features/ai-members/useAgentManagement.ts`
- `packages/desktop/shared/ipc/contract.ts`
- `packages/desktop/renderer/src/shared/ipc/client.test.ts`

## Summary

- Updated `save-agent` to preserve member IDs and use ID-based filenames when an ID is present.
- Updated `delete-agent` to prefer deleting by member ID, keep the legacy name-based fallback, and remove deleted members from team membership references.
- Kept workspace project data aligned with Task 2 by continuing to return `teams`, `unassignedMemberIds`, and team-file diagnostics, while filtering `unassignedMemberIds` to persisted non-virtual members only.
- Updated preload, IPC contract, renderer client, and agent-management delete flows to pass member IDs through the delete transition path.

## Validation Output

### Focused test

`rtk npm test -w packages/desktop -- renderer/src/shared/ipc/client.test.ts`

- PASS: `1` test file, `1` test passed

### Required builds

`rtk npm run build:desktop`

- PASS: file-size guard passed
- PASS: renderer production build completed
- PASS: Electron main TypeScript build completed

`rtk npm run build:engine`

- PASS: file-size guard passed
- PASS: engine TypeScript build completed

## Commit Hash

- `43e4a3898f946f6e91dd4a3c08a22f47c5427eeb`

## Self-Review Notes

- Added a red-green test only where a local harness already exists: the renderer IPC wrapper now proves the optional `memberId` is forwarded to preload.
- No focused main-process IPC test was added because the desktop package does not currently expose a nearby unit/integration harness for Electron `ipcMain` handlers or project-root filesystem mutation flows. The required desktop and engine builds were used as the verification gate for those changes.
- `workspace.ts` already contained the Task 2 team-loading and diagnostics integration, so Task 3 only needed the `unassignedMemberIds` alignment change to exclude virtual/template agents.

## Follow-Up Fix Notes

- Preserved the stable member ID during `handleSaveAgent` edits so existing ID-backed members stay ID-backed after rename or save.
- Updated `delete-agent` cleanup to unlink every matching candidate path in mixed-format workspaces instead of stopping after the first deletion.
- Extended the focused renderer IPC test to cover the legacy delete call shape without a member ID.

### Follow-Up Changed Files

- `packages/desktop/main/ipc/agents.ts`
- `packages/desktop/renderer/src/features/ai-members/useAgentManagement.ts`
- `packages/desktop/renderer/src/shared/ipc/client.test.ts`

### Follow-Up Validation Output

`rtk npm test -w packages/desktop -- renderer/src/shared/ipc/client.test.ts`

- PASS: `1` test file, `2` tests passed

`rtk npm run build:desktop`

- PASS: file-size guard passed
- PASS: renderer production build completed
- PASS: Electron main TypeScript build completed

`rtk npm run build:engine`

- PASS: file-size guard passed
- PASS: engine TypeScript build completed

### Follow-Up Fix Commit Hash

- `7903c48a73ddd39859f0bfd724ced14e348df71f`
