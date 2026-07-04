# Team-First AI Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build team-first AI member management with saved reusable members, stable member IDs, `.room/teams/*.json`, team creation wizard, and team-based Discuss selection.

**Architecture:** Keep `.room/members` as the source of truth for executable AI members, add `.room/teams` as an ordered grouping layer by stable `memberIds`, and keep existing discussion/task engine APIs name-based for v1 by resolving selected member IDs to current names at the renderer/main-process roster boundary. Main-process IPC owns filesystem validation, ID assignment, atomic team creation, legacy fallback, and member/team reference cleanup.

**Tech Stack:** TypeScript, React 18, Electron IPC, Vite, Node `fs/promises`, existing ROOM engine/provider APIs, Vitest where existing renderer tests are appropriate.

## Global Constraints

- Source files must stay under 500 lines unless already whitelisted; split new team UI into focused components.
- Do not remove existing `.room/members/*.json` compatibility.
- Do not auto-write migration files for existing workspaces on load.
- Virtual built-in agents are template/source material only; materialize them before storing them in teams.
- Teams store `memberIds`, not member names.
- Member `id` is stable identity; member `name` remains editable runtime display/name metadata.
- Current discussion/task execution remains name-based in v1; resolve member IDs to names immediately before execution.
- Run `rtk npm run build:engine` and `rtk npm run build:desktop` before completion.

---

## File Structure

- `packages/engine/src/agents/registry.ts`: extend `AgentConfig`, validate stable IDs, preserve IDs through `loadAgents`, write ID-based member files.
- `packages/engine/src/agents/registry.test.ts`: add ID validation and `loadAgents` round-trip tests.
- `packages/desktop/main/ipc/team-store.ts`: new main-process helpers for team validation, load/save/delete, unassigned calculation, and atomic team creation.
- `packages/desktop/main/ipc/teams.ts`: new IPC registration for team operations.
- `packages/desktop/main/ipc/agents.ts`: preserve IDs on save, support ID-first delete with legacy name fallback, cleanup team refs on delete.
- `packages/desktop/main/ipc/workspace.ts`: include `teams` and `unassignedMemberIds` in project data, exclude virtual built-ins from saved team calculations.
- `packages/desktop/main/ipc/index.ts`: export/register team IPC.
- `packages/desktop/main/preload.js`: expose explicit team IPC wrappers.
- `packages/desktop/renderer/src/shared/ipc/client.ts`: typed client wrappers for team operations.
- `packages/desktop/shared/types/domain.ts`: add `MemberTeam`, `TeamProjectData`, and optional member `id` fields.
- `packages/desktop/renderer/src/features/ai-members/lib/teamRoster.ts`: pure roster utilities for teams, unassigned, member lookup, dedupe, and ordering.
- `packages/desktop/renderer/src/features/ai-members/lib/teamVariants.ts`: persona variant generation helpers.
- `packages/desktop/renderer/src/features/ai-members/components/AIMembersScreen.tsx`: switch primary view to team cards and empty/recommended state.
- `packages/desktop/renderer/src/features/ai-members/components/TeamCard.tsx`: new team summary card.
- `packages/desktop/renderer/src/features/ai-members/components/TeamDetailScreen.tsx`: new detail screen for ordered team members.
- `packages/desktop/renderer/src/features/ai-members/components/CreateTeamWizard.tsx`: new guided team creation flow.
- `packages/desktop/renderer/src/features/discussions/components/DiscussionTeamSelector.tsx`: new team chips + expandable member selector.
- `packages/desktop/renderer/src/features/discussions/components/DiscussionsScreen.tsx`: use team selector, preserve temp agents.
- `packages/desktop/renderer/src/app/components/WorkspaceRoutes.tsx`: route team detail/create screens and pass team props.
- `packages/desktop/renderer/src/app/App.tsx`: wire team operations and project data reloads.

---

### Task 1: Stable Member IDs In Engine Registry

**Files:**
- Modify: `packages/engine/src/agents/registry.ts`
- Modify: `packages/engine/src/agents/registry.test.ts`

**Interfaces:**
- Produces: `AgentConfig.id?: string`
- Produces: `validateAgentConfig(rawAgent)` preserving valid IDs and rejecting malformed IDs.
- Produces: `saveAgent(dirPath, agent)` writing ID-based filenames when `agent.id` exists.

- [ ] **Step 1: Add failing validation tests**

Add these cases to `packages/engine/src/agents/registry.test.ts`:

```ts
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadAgents, saveAgent, validateAgentConfig } from './registry.js';

describe('member id handling', () => {
  const base = {
    name: 'UX Researcher',
    role: 'UX',
    provider: 'gemini',
    systemPrompt: 'Research interface needs.'
  };

  it('preserves valid stable member IDs', () => {
    const result = validateAgentConfig({ ...base, id: 'mem_ux_researcher_ab12cd' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.agent.id).toBe('mem_ux_researcher_ab12cd');
    }
  });

  it('rejects malformed stable member IDs', () => {
    const result = validateAgentConfig({ ...base, id: '../bad' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/member id/i);
    }
  });

  it('round-trips persisted stable IDs through loadAgents', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-id-'));
    await fs.mkdir(path.join(dir, '.room', 'members'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.room', 'members', 'mem_ux_researcher_ab12cd.json'),
      JSON.stringify({ ...base, id: 'mem_ux_researcher_ab12cd' }, null, 2),
      'utf-8'
    );

    const agents = await loadAgents(dir);
    const agent = agents.find(item => item.name === 'UX Researcher');
    expect(agent?.id).toBe('mem_ux_researcher_ab12cd');
  });

  it('uses ID-based filenames when saving ID-backed members', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-save-'));
    await saveAgent(dir, { ...base, id: 'mem_ux_researcher_ab12cd' });
    const saved = await fs.readFile(
      path.join(dir, '.room', 'members', 'mem_ux_researcher_ab12cd.json'),
      'utf-8'
    );
    expect(JSON.parse(saved).id).toBe('mem_ux_researcher_ab12cd');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -w packages/engine -- registry
```

Expected: FAIL because `AgentConfig.id` is missing or stripped, malformed IDs are not rejected, and save still uses name filenames.

- [ ] **Step 3: Implement ID support**

Update `packages/engine/src/agents/registry.ts`:

```ts
export interface AgentConfig {
  id?: string;
  name: string;
  role: string;
  provider: string;
  modelName?: string;
  systemPrompt: string;
  skills?: string[];
  command?: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: 'safe' | 'dangerous';
  strategy?: string;
  isVirtual?: boolean;
}

const MEMBER_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;

function normalizeMemberId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Invalid member id.');
  }
  const trimmed = value.trim();
  if (!MEMBER_ID_PATTERN.test(trimmed)) {
    throw new Error('Invalid member id.');
  }
  return trimmed;
}
```

Inside `validateAgentConfig`, before returning success:

```ts
let id: string | undefined;
try {
  id = normalizeMemberId(rawAgent.id);
} catch (error: any) {
  return { success: false, error: error.message };
}
```

Then include `id` in the returned `agent` object:

```ts
agent: {
  id,
  name,
  role,
  provider: normalizedProvider,
  modelName: normalizedProvider === 'Local CLI' ? normalizeLocalCliModelName(modelName) : modelName || undefined,
  systemPrompt,
  skills,
  command,
  cliPreset,
  stdinFormat,
  permissionMode,
  strategy: typeof rawAgent.strategy === 'string' ? rawAgent.strategy.trim() : undefined
}
```

Update `saveAgent` filename selection:

```ts
const safeFileBase = agent.id || agent.name.toLowerCase();
const filePath = path.join(agentsDir, `${safeFileBase}.json`);
```

- [ ] **Step 4: Run tests**

Run:

```bash
rtk npm run test -w packages/engine -- registry
rtk npm run build:engine
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/engine/src/agents/registry.ts packages/engine/src/agents/registry.test.ts
rtk git commit -m "feat(engine): preserve stable member ids"
```

---

### Task 2: Team Store And Team IPC

**Files:**
- Create: `packages/desktop/main/ipc/team-store.ts`
- Create: `packages/desktop/main/ipc/teams.ts`
- Modify: `packages/desktop/main/ipc/index.ts`
- Modify: `packages/desktop/main/main.ts` or the IPC registration file that imports `register*Ipc`
- Modify: `packages/desktop/main/preload.js`
- Modify: `packages/desktop/renderer/src/shared/ipc/client.ts`
- Modify: `packages/desktop/shared/types/domain.ts`

**Interfaces:**
- Produces: `MemberTeam` type with `id`, `name`, `description`, `memberIds`, timestamps.
- Produces: IPC: `loadTeams`, `saveTeam`, `deleteTeam`, `createTeamWithMembers`, `updateTeamMembers`.
- Consumes: `validateAgentConfig` from Task 1.

- [ ] **Step 1: Add shared types**

Update `packages/desktop/shared/types/domain.ts`:

```ts
export interface MemberTeam {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectData {
  projectMd: string;
  archMd: string;
  hasScanData?: boolean;
  tasks: string[];
  taskRuns?: any[];
  decisions: string[];
  reviews: string[];
  documents: string[];
  discussions: string[];
  skills: string[];
  agents: any[];
  teams?: MemberTeam[];
  unassignedMemberIds?: string[];
}
```

- [ ] **Step 2: Implement team store helper**

Create `packages/desktop/main/ipc/team-store.ts`:

```ts
import * as fs from 'fs/promises';
import { validateAgentConfig, type AgentConfig } from '@room/engine';
import {
  ROOM_DIR,
  requireBoundProjectRoot,
  resolveWithinProject,
  sanitizeFileName
} from './shared.js';

export interface MemberTeam {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

const TEAM_ID_PATTERN = /^team_[a-z0-9][a-z0-9_-]{2,80}$/;
const MEMBER_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'team';
}

export function createStableId(prefix: 'team' | 'mem', label: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${slugify(label)}_${suffix}`;
}

function normalizeMemberIds(rawIds: unknown): string[] {
  if (!Array.isArray(rawIds)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawId of rawIds) {
    if (typeof rawId !== 'string') continue;
    const id = rawId.trim();
    if (!MEMBER_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function validateTeamConfig(rawTeam: unknown): { success: true; team: MemberTeam } | { success: false; error: string } {
  if (!rawTeam || typeof rawTeam !== 'object' || Array.isArray(rawTeam)) {
    return { success: false, error: 'Invalid team payload.' };
  }
  const record = rawTeam as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return { success: false, error: 'Team name is required.' };
  const id = typeof record.id === 'string' && TEAM_ID_PATTERN.test(record.id)
    ? record.id
    : createStableId('team', name);
  const now = new Date().toISOString();
  return {
    success: true,
    team: {
      id,
      name,
      description: typeof record.description === 'string' ? record.description.trim() : undefined,
      memberIds: normalizeMemberIds(record.memberIds),
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: now
    }
  };
}

export async function loadTeams(projectRoot: string): Promise<MemberTeam[]> {
  const teamsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'teams');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(teamsDir);
  } catch {
    return [];
  }
  const teams: MemberTeam[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await fs.readFile(resolveWithinProject(teamsDir, entry), 'utf-8'));
      const validated = validateTeamConfig(raw);
      if (validated.success) teams.push(validated.team);
    } catch {}
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTeam(projectRoot: string, rawTeam: unknown): Promise<MemberTeam> {
  const validated = validateTeamConfig(rawTeam);
  if (!validated.success) throw new Error(validated.error);
  const teamsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'teams');
  await fs.mkdir(teamsDir, { recursive: true });
  const filePath = resolveWithinProject(teamsDir, `${sanitizeFileName(validated.team.id, 'team')}.json`);
  await fs.writeFile(filePath, JSON.stringify(validated.team, null, 2), 'utf-8');
  return validated.team;
}

export async function deleteTeam(projectRoot: string, teamId: string): Promise<void> {
  const safeId = sanitizeFileName(teamId, 'team');
  await fs.unlink(resolveWithinProject(projectRoot, ROOM_DIR, 'teams', `${safeId}.json`));
}

export async function removeMemberFromTeams(projectRoot: string, memberId: string): Promise<void> {
  const teams = await loadTeams(projectRoot);
  for (const team of teams) {
    if (!team.memberIds.includes(memberId)) continue;
    await saveTeam(projectRoot, {
      ...team,
      memberIds: team.memberIds.filter(id => id !== memberId)
    });
  }
}

export async function createTeamWithMembers(
  projectRoot: string,
  rawTeam: unknown,
  rawMembers: unknown[]
): Promise<{ team: MemberTeam; members: AgentConfig[]; rollbackWarnings: string[] }> {
  const teamResult = validateTeamConfig(rawTeam);
  if (!teamResult.success) throw new Error(teamResult.error);
  const members = rawMembers.map((rawMember) => {
    const memberRecord = rawMember && typeof rawMember === 'object' ? rawMember as Record<string, unknown> : {};
    const id = typeof memberRecord.id === 'string' ? memberRecord.id : createStableId('mem', String(memberRecord.name || 'member'));
    const result = validateAgentConfig({ ...memberRecord, id });
    if (!result.success) throw new Error(result.error);
    return result.agent;
  });
  const memberIds = members.map(member => member.id).filter((id): id is string => !!id);
  const team = { ...teamResult.team, memberIds };
  const membersDir = resolveWithinProject(projectRoot, ROOM_DIR, 'members');
  await fs.mkdir(membersDir, { recursive: true });
  const writtenFiles: string[] = [];
  const rollbackWarnings: string[] = [];
  try {
    for (const member of members) {
      const filePath = resolveWithinProject(membersDir, `${member.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(member, null, 2), 'utf-8');
      writtenFiles.push(filePath);
    }
    const savedTeam = await saveTeam(projectRoot, team);
    return { team: savedTeam, members, rollbackWarnings };
  } catch (error) {
    for (const filePath of writtenFiles) {
      try {
        await fs.unlink(filePath);
      } catch {
        rollbackWarnings.push(filePath);
      }
    }
    throw error;
  }
}

export function requireProjectRootForTeams(dirPath: string): string {
  return requireBoundProjectRoot(dirPath);
}
```

- [ ] **Step 3: Add team IPC registration**

Create `packages/desktop/main/ipc/teams.ts`:

```ts
import { ipcMain } from 'electron';
import {
  createTeamWithMembers,
  deleteTeam,
  loadTeams,
  requireProjectRootForTeams,
  saveTeam
} from './team-store.js';

export function registerTeamsIpc(): void {
  ipcMain.handle('load-teams', async (event, { dirPath }: { dirPath: string }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      return { success: true, teams: await loadTeams(projectRoot) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-team', async (event, { dirPath, team }: { dirPath: string; team: unknown }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      return { success: true, team: await saveTeam(projectRoot, team) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-team', async (event, { dirPath, teamId }: { dirPath: string; teamId: string }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      await deleteTeam(projectRoot, teamId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('create-team-with-members', async (event, { dirPath, team, members }: { dirPath: string; team: unknown; members: unknown[] }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      return { success: true, ...(await createTeamWithMembers(projectRoot, team, Array.isArray(members) ? members : [])) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
```

- [ ] **Step 4: Register IPC and preload/client wrappers**

Update `packages/desktop/main/ipc/index.ts`:

```ts
export { registerTeamsIpc } from './teams.js';
```

Update the main IPC registration file that calls other `register*Ipc()` functions:

```ts
import { registerTeamsIpc } from './ipc/index.js';

registerTeamsIpc();
```

Update `packages/desktop/main/preload.js`:

```js
loadTeams: (dirPath) => ipcRenderer.invoke('load-teams', { dirPath }),
saveTeam: (dirPath, team) => ipcRenderer.invoke('save-team', { dirPath, team }),
deleteTeam: (dirPath, teamId) => ipcRenderer.invoke('delete-team', { dirPath, teamId }),
createTeamWithMembers: (dirPath, team, members) => ipcRenderer.invoke('create-team-with-members', { dirPath, team, members }),
```

Update `packages/desktop/renderer/src/shared/ipc/client.ts`:

```ts
loadTeams: (dirPath: string) => window.electronAPI.loadTeams(dirPath),
saveTeam: (dirPath: string, team: any) => window.electronAPI.saveTeam(dirPath, team),
deleteTeam: (dirPath: string, teamId: string) => window.electronAPI.deleteTeam(dirPath, teamId),
createTeamWithMembers: (dirPath: string, team: any, members: any[]) =>
  window.electronAPI.createTeamWithMembers(dirPath, team, members),
```

- [ ] **Step 5: Run build**

Run:

```bash
rtk npm run build:desktop
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/desktop/main/ipc packages/desktop/main/preload.js packages/desktop/renderer/src/shared/ipc/client.ts packages/desktop/shared/types/domain.ts
rtk git commit -m "feat(desktop): add team persistence ipc"
```

---

### Task 3: Member Save/Delete Transition And Workspace Data

**Files:**
- Modify: `packages/desktop/main/ipc/agents.ts`
- Modify: `packages/desktop/main/ipc/workspace.ts`
- Modify: `packages/desktop/renderer/src/types/domain.ts`

**Interfaces:**
- Consumes: `removeMemberFromTeams(projectRoot, memberId)` from Task 2.
- Produces: `projectData.teams` and `projectData.unassignedMemberIds`.
- Produces: `deleteAgent` supporting `{ memberId, agentName }` transition.

- [ ] **Step 1: Update delete-agent IPC signature and cleanup**

In `packages/desktop/main/ipc/agents.ts`, import:

```ts
import { removeMemberFromTeams } from './team-store.js';
```

Replace delete handler logic with ID-first behavior:

```ts
ipcMain.handle('delete-agent', async (event, { dirPath, agentName, memberId }: { dirPath: string; agentName?: string; memberId?: string }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const filePaths: string[] = [];
    if (typeof memberId === 'string' && /^mem_[a-z0-9][a-z0-9_-]{2,80}$/.test(memberId)) {
      filePaths.push(resolveWithinProject(projectRoot, ROOM_DIR, 'members', `${memberId}.json`));
    }
    if (agentName) {
      const safeAgentName = sanitizeFileName(agentName.toLowerCase(), 'agent');
      const filename = `${safeAgentName.replace(/[^a-z0-9_-]/g, '-')}.json`;
      filePaths.push(
        resolveWithinProject(projectRoot, ROOM_DIR, 'members', filename),
        resolveWithinProject(projectRoot, ROOM_DIR, 'agents', filename)
      );
    }

    let deleted = false;
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
        deleted = true;
        break;
      } catch {}
    }
    if (!deleted) {
      return { success: false, error: 'Agent was not found.' };
    }
    if (memberId) {
      await removeMemberFromTeams(projectRoot, memberId);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
```

- [ ] **Step 2: Preserve ID on save-agent IPC**

In `save-agent`, after validation, select filename by ID:

```ts
const safeFileBase = validated.agent.id || sanitizeAgentFileName(validated.agent.name) || 'agent';
const filename = `${safeFileBase}.json`;
```

Ensure the written JSON includes `validated.agent.id` when present.

- [ ] **Step 3: Include teams and unassigned in workspace data**

In `packages/desktop/main/ipc/workspace.ts`, import:

```ts
import { loadTeams } from './team-store.js';
```

Where project data is assembled:

```ts
const teams = await loadTeams(projectRoot);
const teamMemberIds = new Set(teams.flatMap(team => team.memberIds));
const unassignedMemberIds = updatedAgents
  .filter(agent => !agent.isVirtual && typeof agent.id === 'string' && !teamMemberIds.has(agent.id))
  .map(agent => agent.id);
```

Include:

```ts
teams,
unassignedMemberIds
```

- [ ] **Step 4: Update renderer delete call**

Update `packages/desktop/renderer/src/shared/ipc/client.ts` and preload signatures to accept optional member ID while preserving current call sites:

```ts
deleteAgent: (dirPath: string, agentName: string, memberId?: string) =>
  window.electronAPI.deleteAgent(dirPath, agentName, memberId),
```

```js
deleteAgent: (dirPath, agentName, memberId) => ipcRenderer.invoke('delete-agent', { dirPath, agentName, memberId }),
```

Update `handleDeleteAgent` in `useAgentManagement.ts` to find the current member and pass `editingAgent?.id` or matching project agent ID:

```ts
const member = (projectData?.agents || []).find((agent: any) => agent.name === agentName);
const res = await api.deleteAgent(projectPath, agentName, member?.id);
```

- [ ] **Step 5: Run validation**

Run:

```bash
rtk npm run build:desktop
rtk npm run build:engine
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/desktop/main/ipc/agents.ts packages/desktop/main/ipc/workspace.ts packages/desktop/main/preload.js packages/desktop/renderer/src/shared/ipc/client.ts packages/desktop/renderer/src/features/ai-members/useAgentManagement.ts
rtk git commit -m "feat(desktop): support id-backed member lifecycle"
```

---

### Task 4: Roster Utilities And Variant Generation

**Files:**
- Create: `packages/desktop/renderer/src/features/ai-members/lib/teamRoster.ts`
- Create: `packages/desktop/renderer/src/features/ai-members/lib/teamVariants.ts`
- Test: `packages/desktop/renderer/src/features/ai-members/lib/teamRoster.test.ts`
- Test: `packages/desktop/renderer/src/features/ai-members/lib/teamVariants.test.ts`

**Interfaces:**
- Produces: `buildTeamRosters(agents, teams, unassignedMemberIds)`.
- Produces: `dedupeMemberIdsInOrder(memberIds)`.
- Produces: `generateTemplateVariants(templateName, count, existingNames)`.

- [ ] **Step 1: Add roster utility tests**

Create `teamRoster.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildTeamRosters, dedupeMemberIdsInOrder } from './teamRoster.js';

describe('team roster utilities', () => {
  it('dedupes member ids while preserving first position', () => {
    expect(dedupeMemberIdsInOrder(['mem_a_123', 'mem_b_123', 'mem_a_123'])).toEqual(['mem_a_123', 'mem_b_123']);
  });

  it('builds teams and excludes virtual agents from unassigned', () => {
    const agents = [
      { id: 'mem_a_123', name: 'UX Researcher', role: 'UX' },
      { id: 'mem_b_123', name: 'UX Critic', role: 'UX' },
      { name: 'Developer', role: 'Developer', isVirtual: true }
    ];
    const teams = [{ id: 'team_ux_123', name: 'UX/UI', memberIds: ['mem_a_123'], createdAt: '', updatedAt: '' }];
    const rosters = buildTeamRosters(agents, teams, ['mem_b_123']);
    expect(rosters.userTeams[0].members.map(member => member.name)).toEqual(['UX Researcher']);
    expect(rosters.unassigned.members.map(member => member.name)).toEqual(['UX Critic']);
  });
});
```

- [ ] **Step 2: Implement roster utility**

Create `teamRoster.ts`:

```ts
import type { MemberTeam } from '../../../../types/domain.js';

export interface TeamRoster {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  members: any[];
  virtual?: boolean;
}

export function dedupeMemberIdsInOrder(memberIds: string[]): string[] {
  const seen = new Set<string>();
  return memberIds.filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function buildTeamRosters(
  agents: any[],
  teams: MemberTeam[] = [],
  unassignedMemberIds: string[] = []
): { userTeams: TeamRoster[]; unassigned: TeamRoster } {
  const savedAgentsById = new Map(
    agents
      .filter(agent => !agent.isVirtual && typeof agent.id === 'string')
      .map(agent => [agent.id, agent])
  );
  const userTeams = teams.map(team => ({
    ...team,
    memberIds: dedupeMemberIdsInOrder(team.memberIds || []),
    members: dedupeMemberIdsInOrder(team.memberIds || [])
      .map(id => savedAgentsById.get(id))
      .filter(Boolean)
  }));
  const unassignedIds = dedupeMemberIdsInOrder(unassignedMemberIds)
    .filter(id => savedAgentsById.has(id));
  return {
    userTeams,
    unassigned: {
      id: 'unassigned',
      name: 'Unassigned',
      memberIds: unassignedIds,
      members: unassignedIds.map(id => savedAgentsById.get(id)).filter(Boolean),
      virtual: true
    }
  };
}
```

- [ ] **Step 3: Add variant tests**

Create `teamVariants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateTemplateVariants } from './teamVariants.js';

describe('team variant generation', () => {
  it('generates differentiated UX variants', () => {
    const variants = generateTemplateVariants('UX', 3, []);
    expect(variants.map(variant => variant.name)).toEqual([
      'UX Researcher',
      'UX Interaction Designer',
      'UX Visual Critic'
    ]);
    expect(new Set(variants.map(variant => variant.personaAngle)).size).toBe(3);
  });

  it('suffixes colliding names', () => {
    const variants = generateTemplateVariants('UX', 1, ['UX Researcher']);
    expect(variants[0].name).toBe('UX Researcher 2');
  });
});
```

- [ ] **Step 4: Implement variant utility**

Create `teamVariants.ts`:

```ts
const VARIANT_ANGLES: Record<string, Array<{ suffix: string; angle: string }>> = {
  UX: [
    { suffix: 'Researcher', angle: 'Focus on user needs, evidence, tasks, and usability risks.' },
    { suffix: 'Interaction Designer', angle: 'Focus on flows, controls, states, and repeated-use ergonomics.' },
    { suffix: 'Visual Critic', angle: 'Focus on hierarchy, composition, polish, and visual consistency.' }
  ],
  Developer: [
    { suffix: 'Implementer', angle: 'Focus on direct implementation and integration details.' },
    { suffix: 'Reviewer', angle: 'Focus on correctness, maintainability, and regressions.' },
    { suffix: 'QA Analyst', angle: 'Focus on validation, edge cases, and failure modes.' }
  ]
};

const FALLBACK_ANGLES = [
  { suffix: 'Strategy', angle: 'Focus on goals, tradeoffs, and decision criteria.' },
  { suffix: 'Execution', angle: 'Focus on concrete steps, dependencies, and delivery.' },
  { suffix: 'Critique', angle: 'Focus on risks, contradictions, and missing evidence.' },
  { suffix: 'Research', angle: 'Focus on assumptions, evidence, and open questions.' },
  { suffix: 'QA', angle: 'Focus on validation, acceptance criteria, and edge cases.' }
];

export interface GeneratedVariant {
  name: string;
  personaAngle: string;
}

function uniqueName(candidate: string, used: Set<string>): string {
  let suffix = 2;
  let next = candidate;
  while (used.has(next.toLowerCase())) {
    next = `${candidate} ${suffix}`;
    suffix += 1;
  }
  used.add(next.toLowerCase());
  return next;
}

export function generateTemplateVariants(templateName: string, count: number, existingNames: string[]): GeneratedVariant[] {
  const variants = VARIANT_ANGLES[templateName] || FALLBACK_ANGLES;
  const used = new Set(existingNames.map(name => name.toLowerCase()));
  return Array.from({ length: Math.max(1, Math.min(12, count)) }, (_, index) => {
    const variant = variants[index % variants.length];
    return {
      name: uniqueName(`${templateName} ${variant.suffix}`, used),
      personaAngle: variant.angle
    };
  });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
rtk npx vitest run packages/desktop/renderer/src/features/ai-members/lib/teamRoster.test.ts packages/desktop/renderer/src/features/ai-members/lib/teamVariants.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/desktop/renderer/src/features/ai-members/lib
rtk git commit -m "feat(desktop): add team roster utilities"
```

---

### Task 5: AI Members Team-First UI And Wizard

**Files:**
- Modify: `packages/desktop/renderer/src/features/ai-members/components/AIMembersScreen.tsx`
- Create: `packages/desktop/renderer/src/features/ai-members/components/TeamCard.tsx`
- Create: `packages/desktop/renderer/src/features/ai-members/components/CreateTeamWizard.tsx`
- Create: `packages/desktop/renderer/src/features/ai-members/components/TeamDetailScreen.tsx`
- Modify: `packages/desktop/renderer/src/app/components/WorkspaceRoutes.tsx`
- Modify: `packages/desktop/renderer/src/app/App.tsx`

**Interfaces:**
- Consumes: `projectData.teams`, `projectData.unassignedMemberIds`.
- Consumes: `api.createTeamWithMembers(projectPath, team, members)`.
- Consumes: `buildTeamRosters`, `generateTemplateVariants`.

- [ ] **Step 1: Create TeamCard component**

Create `TeamCard.tsx`:

```tsx
import React from 'react';

interface TeamCardProps {
  team: {
    id: string;
    name: string;
    description?: string;
    members: any[];
    virtual?: boolean;
  };
  onOpen: () => void;
}

export const TeamCard: React.FC<TeamCardProps> = ({ team, onOpen }) => (
  <button
    type="button"
    className="team-card"
    onClick={onOpen}
    style={{
      textAlign: 'left',
      padding: '14px 16px',
      borderRadius: '8px',
      border: '1px solid hsl(var(--border-dim))',
      background: 'hsl(var(--bg-card))',
      color: 'inherit',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minHeight: '124px'
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
      <strong style={{ color: 'white', fontSize: '0.92rem' }}>{team.name}</strong>
      <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem' }}>
        {team.members.length} member{team.members.length === 1 ? '' : 's'}
      </span>
    </div>
    {team.description && (
      <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.76rem', lineHeight: 1.4 }}>
        {team.description}
      </div>
    )}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: 'auto' }}>
      {team.members.slice(0, 5).map(member => (
        <span key={member.id || member.name} style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: '999px', background: 'hsl(var(--bg-input))', color: 'hsl(var(--text-secondary))', border: '1px solid hsl(var(--border-dim))' }}>
          {member.name}
        </span>
      ))}
      {team.members.length === 0 && <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem' }}>Empty team</span>}
    </div>
  </button>
);
```

- [ ] **Step 2: Create CreateTeamWizard component**

Create `CreateTeamWizard.tsx` with a minimal first version:

```tsx
import React from 'react';
import { agentPersonaTemplates } from '../../../shared/data/staticData.js';
import { generateTemplateVariants } from '../lib/teamVariants.js';

interface CreateTeamWizardProps {
  existingNames: string[];
  onCancel: () => void;
  onCreate: (team: { name: string; description?: string }, members: any[]) => Promise<void>;
}

export const CreateTeamWizard: React.FC<CreateTeamWizardProps> = ({ existingNames, onCancel, onCreate }) => {
  const [teamName, setTeamName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [templateName, setTemplateName] = React.useState(agentPersonaTemplates[0]?.name || '');
  const [count, setCount] = React.useState(3);
  const [saving, setSaving] = React.useState(false);
  const template = agentPersonaTemplates.find(item => item.name === templateName);
  const variants = template ? generateTemplateVariants(template.name, count, existingNames) : [];

  const members = variants.map(variant => ({
    name: variant.name,
    role: template?.role || templateName,
    provider: template?.provider || 'gemini',
    systemPrompt: `${template?.prompt || ''}\n\n=== Persona Variant ===\n${variant.personaAngle}`,
    skills: []
  }));

  return (
    <div style={{ padding: '16px', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', background: 'hsl(var(--bg-card))', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <input className="form-input" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Team name, e.g. UX/UI" />
      <input className="form-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
      <div style={{ display: 'flex', gap: '8px' }}>
        <select className="form-select" value={templateName} onChange={(event) => setTemplateName(event.target.value)}>
          {agentPersonaTemplates.map(templateOption => <option key={templateOption.name} value={templateOption.name}>{templateOption.name}</option>)}
        </select>
        <select className="form-select" value={count} onChange={(event) => setCount(Number(event.target.value))}>
          {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {members.map(member => <div key={member.name} style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.8rem' }}>{member.name}</div>)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!teamName.trim() || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onCreate({ name: teamName.trim(), description: description.trim() || undefined }, members);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Creating...' : 'Create Team'}
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Switch AIMembersScreen to team-first view**

In `AIMembersScreen.tsx`, import `buildTeamRosters`, `TeamCard`, and `CreateTeamWizard`. Add local state:

```tsx
const [showCreateTeam, setShowCreateTeam] = React.useState(false);
const { userTeams, unassigned } = buildTeamRosters(agents, projectData?.teams || [], projectData?.unassignedMemberIds || []);
const visibleTeams = unassigned.members.length > 0 ? [...userTeams, unassigned] : userTeams;
```

Render Recommended Teams only when `userTeams.length === 0 && !showCreateTeam`. Render `visibleTeams` cards otherwise. The `onCreate` handler should call:

```tsx
await api.createTeamWithMembers(projectPath, team, members);
await loadProjectData(projectPath);
setShowCreateTeam(false);
```

Add `projectPath`, `loadProjectData`, and `api` wiring as needed.

- [ ] **Step 4: Add TeamDetailScreen route**

Create `TeamDetailScreen.tsx`:

```tsx
import React from 'react';

interface TeamDetailScreenProps {
  team: any;
  setActiveTab: (tab: string) => void;
}

export const TeamDetailScreen: React.FC<TeamDetailScreenProps> = ({ team, setActiveTab }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
    <button type="button" className="btn-secondary" onClick={() => setActiveTab('AI Members')} style={{ alignSelf: 'flex-start' }}>
      Back to Teams
    </button>
    <h2 style={{ color: 'white' }}>{team.name}</h2>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {team.members.map((member: any, index: number) => (
        <div key={member.id || member.name} style={{ padding: '10px 12px', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', background: 'hsl(var(--bg-card))', display: 'flex', justifyContent: 'space-between' }}>
          <span>{index + 1}. {member.name}</span>
          <button type="button" className="btn-secondary" onClick={() => setActiveTab(`Agent:${member.name}`)}>Edit</button>
        </div>
      ))}
    </div>
  </div>
);
```

Wire `WorkspaceRoutes` to recognize `activeTab.startsWith('Team:')` and locate the roster by team ID.

- [ ] **Step 5: Run build**

Run:

```bash
rtk npm run build:desktop
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/desktop/renderer/src/features/ai-members packages/desktop/renderer/src/app packages/desktop/shared/types/domain.ts
rtk git commit -m "feat(desktop): show ai members as teams"
```

---

### Task 6: Discuss Team Selector

**Files:**
- Create: `packages/desktop/renderer/src/features/discussions/components/DiscussionTeamSelector.tsx`
- Modify: `packages/desktop/renderer/src/features/discussions/components/DiscussionsScreen.tsx`
- Modify: `packages/desktop/renderer/src/features/discussions/useDiscussion.ts`

**Interfaces:**
- Consumes: `projectData.teams`, `projectData.unassignedMemberIds`, saved member IDs.
- Produces: selected discussion participant names resolved from selected team/member IDs.

- [ ] **Step 1: Create DiscussionTeamSelector**

Create `DiscussionTeamSelector.tsx`:

```tsx
import React from 'react';

interface DiscussionTeamSelectorProps {
  teams: Array<{ id: string; name: string; members: any[] }>;
  selectedNames: string[];
  setSelectedNames: React.Dispatch<React.SetStateAction<string[]>>;
}

export const DiscussionTeamSelector: React.FC<DiscussionTeamSelectorProps> = ({ teams, selectedNames, setSelectedNames }) => {
  const [expandedTeamIds, setExpandedTeamIds] = React.useState<Record<string, boolean>>({});

  const addTeam = (team: { members: any[] }) => {
    setSelectedNames(prev => {
      const next = [...prev];
      for (const member of team.members) {
        if (!next.includes(member.name)) next.push(member.name);
      }
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {teams.map(team => (
          <button key={team.id} type="button" className="btn-secondary" onClick={() => addTeam(team)} style={{ padding: '5px 10px', fontSize: '0.74rem' }}>
            + {team.name}
          </button>
        ))}
      </div>
      {teams.map(team => (
        <div key={team.id}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setExpandedTeamIds(prev => ({ ...prev, [team.id]: !prev[team.id] }))}
            style={{ padding: '4px 8px', fontSize: '0.7rem' }}
          >
            {expandedTeamIds[team.id] ? 'Hide' : 'Show'} {team.name} members
          </button>
          {expandedTeamIds[team.id] && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
              {team.members.map(member => {
                const selected = selectedNames.includes(member.name);
                return (
                  <button
                    key={member.id || member.name}
                    type="button"
                    className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                    onClick={() => setSelectedNames(prev => selected ? prev.filter(name => name !== member.name) : [...prev, member.name])}
                  >
                    {selected ? '✓ ' : '+ '}{member.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Use selector in DiscussionsScreen**

Build rosters:

```tsx
const { userTeams, unassigned } = buildTeamRosters(projectData?.agents || [], projectData?.teams || [], projectData?.unassignedMemberIds || []);
const discussionTeams = unassigned.members.length > 0 ? [...userTeams, unassigned] : userTeams;
```

Render `DiscussionTeamSelector` above individual selected chips and keep `AgentClonePicker` for temp agents.

- [ ] **Step 3: Preserve name validation**

In `useDiscussion`, keep existing selected name validation but ensure only saved/temporary agents are valid:

```ts
const availableAgentNames = new Set([
  ...(projectData?.agents || []).filter((agent: any) => !agent.isVirtual).map((agent: any) => agent.name),
  ...temporaryDiscussionAgents.map((agent: any) => agent.name)
]);
```

- [ ] **Step 4: Run build**

Run:

```bash
rtk npm run build:desktop
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/desktop/renderer/src/features/discussions packages/desktop/renderer/src/features/ai-members/lib/teamRoster.ts
rtk git commit -m "feat(desktop): select discussion members by team"
```

---

### Task 7: Final Verification And Packaging

**Files:**
- No source changes expected unless verification exposes issues.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: packaged macOS app.

- [ ] **Step 1: Run full validation**

Run:

```bash
rtk npm run build:engine
rtk npm run build:desktop
```

Expected: both PASS.

- [ ] **Step 2: Package desktop app**

Run:

```bash
rtk npm run package:desktop
```

Expected: package output under `packages/desktop/dist-packaged/mac-arm64`.

- [ ] **Step 3: Manual smoke checks**

In the app:

```text
1. Open a workspace with existing members but no teams.
2. Confirm AI Members shows Recommended Teams and Unassigned members.
3. Create a UX/UI team with UX x3.
4. Confirm three saved members are created with different names/persona angles.
5. Confirm the team card shows 3 members.
6. Open Discuss.
7. Select the UX/UI team.
8. Confirm selected participants are appended in team order and duplicates are not added.
9. Add a temporary expert and confirm it is selected without appearing in teams.
10. Delete a saved team member and confirm the team no longer references it.
```

- [ ] **Step 4: Commit any verification fixes**

If fixes were needed:

```bash
rtk git add <changed-files>
rtk git commit -m "fix(desktop): stabilize team-first member flow"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: tasks cover stable member IDs, validation, ID-based persistence, team storage, virtual built-in handling, atomic team creation, unassigned, AI Members team UI, Discuss team selection, deletion cleanup, migration behavior, and verification.
- Placeholder scan: no unresolved placeholders are intentionally left in the task steps.
- Type consistency: team references use `memberIds`; runtime execution remains name-based after roster resolution; `MemberTeam` and `AgentConfig.id` are the shared contracts.
