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
- Produces: distinct validators:
  - `validateNewTeamDraft` may generate a missing `team.id` for new drafts.
  - `validatePersistedTeamConfig` must reject malformed persisted IDs and malformed `memberIds`.
- Produces: team load diagnostics for invalid persisted team files skipped during `loadTeams`.
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
  workspaceDiagnostics?: Array<{ source: string; message: string }>;
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
import { randomUUID } from 'crypto';
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

export interface TeamStoreDiagnostic {
  filePath: string;
  error: string;
}

export interface LoadTeamsResult {
  teams: MemberTeam[];
  diagnostics: TeamStoreDiagnostic[];
}

export interface SkillDraft {
  name: string;
  content: string;
}

const TEAM_ID_PATTERN = /^team_[a-z0-9][a-z0-9_-]{2,80}$/;
const MEMBER_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'team';
}

export function createStableId(prefix: 'team' | 'mem', label: string): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  return `${prefix}_${slugify(label)}_${suffix}`;
}

function parseMemberIds(rawIds: unknown): { success: true; memberIds: string[] } | { success: false; error: string } {
  if (!Array.isArray(rawIds)) return { success: true, memberIds: [] };
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawId of rawIds) {
    if (typeof rawId !== 'string') return { success: false, error: 'Team memberIds must contain only strings.' };
    const id = rawId.trim();
    if (!MEMBER_ID_PATTERN.test(id)) return { success: false, error: `Invalid member id: ${id}` };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { success: true, memberIds: ids };
}

function validateTeamShape(
  rawTeam: unknown,
  options: { allowMissingId: boolean }
): { success: true; team: MemberTeam } | { success: false; error: string } {
  if (!rawTeam || typeof rawTeam !== 'object' || Array.isArray(rawTeam)) {
    return { success: false, error: 'Invalid team payload.' };
  }
  const record = rawTeam as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return { success: false, error: 'Team name is required.' };
  let id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id && options.allowMissingId) {
    id = createStableId('team', name);
  }
  if (!TEAM_ID_PATTERN.test(id)) return { success: false, error: `Invalid team id: ${id || '(missing)'}` };
  const memberIdsResult = parseMemberIds(record.memberIds);
  if (!memberIdsResult.success) return memberIdsResult;
  const now = new Date().toISOString();
  return {
    success: true,
    team: {
      id,
      name,
      description: typeof record.description === 'string' ? record.description.trim() : undefined,
      memberIds: memberIdsResult.memberIds,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: now
    }
  };
}

export function validateNewTeamDraft(rawTeam: unknown): { success: true; team: MemberTeam } | { success: false; error: string } {
  return validateTeamShape(rawTeam, { allowMissingId: true });
}

export function validatePersistedTeamConfig(rawTeam: unknown): { success: true; team: MemberTeam } | { success: false; error: string } {
  return validateTeamShape(rawTeam, { allowMissingId: false });
}

export async function loadTeamsWithDiagnostics(projectRoot: string): Promise<LoadTeamsResult> {
  const teamsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'teams');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(teamsDir);
  } catch {
    return { teams: [], diagnostics: [] };
  }
  const teams: MemberTeam[] = [];
  const diagnostics: TeamStoreDiagnostic[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = resolveWithinProject(teamsDir, entry);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      const validated = validatePersistedTeamConfig(raw);
      if (validated.success) teams.push(validated.team);
      else diagnostics.push({ filePath, error: validated.error });
    } catch (error) {
      diagnostics.push({ filePath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { teams: teams.sort((a, b) => a.name.localeCompare(b.name)), diagnostics };
}

export async function loadTeams(projectRoot: string): Promise<MemberTeam[]> {
  const result = await loadTeamsWithDiagnostics(projectRoot);
  return result.teams;
}

export async function saveTeam(projectRoot: string, rawTeam: unknown): Promise<MemberTeam> {
  const validated = validateNewTeamDraft(rawTeam);
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

export async function updateTeamMembers(projectRoot: string, teamId: string, memberIds: unknown): Promise<MemberTeam> {
  if (!TEAM_ID_PATTERN.test(teamId)) throw new Error('Invalid team id.');
  const parsedMemberIds = parseMemberIds(memberIds);
  if (!parsedMemberIds.success) throw new Error(parsedMemberIds.error);
  const teams = await loadTeams(projectRoot);
  const current = teams.find(team => team.id === teamId);
  if (!current) throw new Error('Team not found.');
  return saveTeam(projectRoot, { ...current, memberIds: parsedMemberIds.memberIds });
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
  rawMembers: unknown[],
  skillDrafts: SkillDraft[] = []
): Promise<{ team: MemberTeam; members: AgentConfig[]; rollbackWarnings: string[] }> {
  const teamResult = validateNewTeamDraft(rawTeam);
  if (!teamResult.success) throw new Error(teamResult.error);
  const members = rawMembers.map((rawMember) => {
    const memberRecord = rawMember && typeof rawMember === 'object' ? rawMember as Record<string, unknown> : {};
    const id = typeof memberRecord.id === 'string' ? memberRecord.id.trim() : createStableId('mem', String(memberRecord.name || 'member'));
    if (!MEMBER_ID_PATTERN.test(id)) throw new Error(`Invalid member id: ${id}`);
    const result = validateAgentConfig({ ...memberRecord, id });
    if (!result.success) throw new Error(result.error);
    return result.agent;
  });
  const memberIds = members.map(member => member.id).filter((id): id is string => !!id);
  if (new Set(memberIds).size !== memberIds.length) throw new Error('Duplicate member ids in team create payload.');
  const team = { ...teamResult.team, memberIds };
  const membersDir = resolveWithinProject(projectRoot, ROOM_DIR, 'members');
  const teamsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'teams');
  const skillsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'skills');
  await fs.mkdir(membersDir, { recursive: true });
  await fs.mkdir(teamsDir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });
  for (const skill of skillDrafts) {
    if (!skill.name.trim()) throw new Error('Skill draft name is required.');
    if (!skill.content.trim()) throw new Error(`Skill draft ${skill.name} is empty.`);
  }
  const writes = [
    ...members.map(member => ({
      finalPath: resolveWithinProject(membersDir, `${member.id}.json`),
      content: JSON.stringify(member, null, 2)
    })),
    {
      finalPath: resolveWithinProject(teamsDir, `${sanitizeFileName(team.id, 'team')}.json`),
      content: JSON.stringify(team, null, 2)
    },
    ...skillDrafts.map(skill => ({
      finalPath: resolveWithinProject(skillsDir, `${sanitizeFileName(skill.name, 'skill')}.md`),
      content: skill.content
    }))
  ];
  if (new Set(writes.map(write => write.finalPath)).size !== writes.length) {
    throw new Error('Duplicate write path in team transaction.');
  }
  const reservedFiles: string[] = [];
  const completedFiles: string[] = [];
  const tempFiles: string[] = [];
  const rollbackWarnings: string[] = [];
  try {
    for (const write of writes) {
      await fs.writeFile(write.finalPath, '', { encoding: 'utf-8', flag: 'wx' });
      reservedFiles.push(write.finalPath);
    }
    for (const write of writes) {
      const tempPath = `${write.finalPath}.${randomUUID()}.tmp`;
      await fs.writeFile(tempPath, write.content, { encoding: 'utf-8', flag: 'wx' });
      tempFiles.push(tempPath);
      await fs.rename(tempPath, write.finalPath);
      tempFiles.splice(tempFiles.indexOf(tempPath), 1);
      completedFiles.push(write.finalPath);
    }
    return { team, members, rollbackWarnings };
  } catch (error) {
    for (const filePath of [...new Set([...completedFiles, ...reservedFiles, ...tempFiles])]) {
      try { await fs.unlink(filePath); }
      catch { rollbackWarnings.push(filePath); }
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
  saveTeam,
  updateTeamMembers
} from './team-store.js';
import type { SkillDraft } from './team-store.js';

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

  ipcMain.handle('update-team-members', async (event, { dirPath, teamId, memberIds }: { dirPath: string; teamId: string; memberIds: unknown }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      return { success: true, team: await updateTeamMembers(projectRoot, teamId, memberIds) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('create-team-with-members', async (event, { dirPath, team, members, skillDrafts }: { dirPath: string; team: unknown; members: unknown[]; skillDrafts?: SkillDraft[] }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      return {
        success: true,
        ...(await createTeamWithMembers(
          projectRoot,
          team,
          Array.isArray(members) ? members : [],
          Array.isArray(skillDrafts) ? skillDrafts : []
        ))
      };
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
updateTeamMembers: (dirPath, teamId, memberIds) => ipcRenderer.invoke('update-team-members', { dirPath, teamId, memberIds }),
createTeamWithMembers: (dirPath, team, members, skillDrafts = []) =>
  ipcRenderer.invoke('create-team-with-members', { dirPath, team, members, skillDrafts }),
```

Update `packages/desktop/renderer/src/shared/ipc/client.ts`:

```ts
loadTeams: (dirPath: string) => window.electronAPI.loadTeams(dirPath),
saveTeam: (dirPath: string, team: any) => window.electronAPI.saveTeam(dirPath, team),
deleteTeam: (dirPath: string, teamId: string) => window.electronAPI.deleteTeam(dirPath, teamId),
updateTeamMembers: (dirPath: string, teamId: string, memberIds: string[]) =>
  window.electronAPI.updateTeamMembers(dirPath, teamId, memberIds),
createTeamWithMembers: (dirPath: string, team: unknown, members: unknown[], skillDrafts: Array<{ name: string; content: string }> = []) =>
  window.electronAPI.createTeamWithMembers(dirPath, team, members, skillDrafts),
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
- Produces: `projectData.workspaceDiagnostics` entries for invalid skipped team files.
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
import { loadTeamsWithDiagnostics } from './team-store.js';
```

Where project data is assembled:

```ts
const { teams, diagnostics: teamDiagnostics } = await loadTeamsWithDiagnostics(projectRoot);
const teamMemberIds = new Set(teams.flatMap(team => team.memberIds));
const unassignedMemberIds = updatedAgents
  .filter(agent => !agent.isVirtual && typeof agent.id === 'string' && !teamMemberIds.has(agent.id))
  .map(agent => agent.id);
```

Include:

```ts
teams,
unassignedMemberIds,
workspaceDiagnostics: [
  ...(existingWorkspaceDiagnostics || []),
  ...teamDiagnostics.map(diagnostic => ({
    source: diagnostic.filePath,
    message: diagnostic.error
  }))
]
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
- Consumes: `api.createTeamWithMembers(projectPath, team, members, skillDrafts)`.
- Consumes: `api.updateTeamMembers(projectPath, teamId, memberIds)` for reorder/add/remove.
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

Create `CreateTeamWizard.tsx` with first-version controls required by the spec:

- Team draft fields: name and description.
- Template rows: add/remove rows, each row selects a built-in template and count.
- Review table: every generated member draft can edit name, role, persona angle, skills, provider, and model before create.
- Submit payload: `onCreate(team, members, skillDrafts)` where `members` are complete member configs and `skillDrafts` contains any new skill files requested by the edited drafts.

```tsx
import React from 'react';
import { agentPersonaTemplates } from '../../../shared/data/staticData.js';
import { generateTemplateVariants } from '../lib/teamVariants.js';

interface TemplateRow {
  id: string;
  templateName: string;
  count: number;
}

interface MemberDraft {
  draftId: string;
  name: string;
  role: string;
  personaAngle: string;
  provider: string;
  model?: string;
  skills: string[];
  systemPrompt: string;
}

interface CreateTeamWizardProps {
  existingNames: string[];
  onCancel: () => void;
  onCreate: (team: { name: string; description?: string }, members: MemberDraft[], skillDrafts: Array<{ name: string; content: string }>) => Promise<void>;
}

export const CreateTeamWizard: React.FC<CreateTeamWizardProps> = ({ existingNames, onCancel, onCreate }) => {
  const [teamName, setTeamName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [templateRows, setTemplateRows] = React.useState<TemplateRow[]>([
    { id: crypto.randomUUID(), templateName: agentPersonaTemplates[0]?.name || '', count: 3 }
  ]);
  const [memberDrafts, setMemberDrafts] = React.useState<MemberDraft[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const nextDrafts = templateRows.flatMap(row => {
      const template = agentPersonaTemplates.find(item => item.name === row.templateName);
      if (!template) return [];
      return generateTemplateVariants(template.name, row.count, existingNames).map(variant => ({
        draftId: `${row.id}:${variant.name}`,
        name: variant.name,
        role: template.role || template.name,
        personaAngle: variant.personaAngle,
        provider: template.provider || 'gemini',
        model: template.model,
        skills: [],
        systemPrompt: `${template.prompt || ''}\n\n=== Persona Variant ===\n${variant.personaAngle}`
      }));
    });
    setMemberDrafts(previous => nextDrafts.map(next => previous.find(item => item.draftId === next.draftId) || next));
  }, [existingNames, templateRows]);

  const updateDraft = (draftId: string, patch: Partial<MemberDraft>) => {
    setMemberDrafts(previous => previous.map(draft => draft.draftId === draftId ? { ...draft, ...patch } : draft));
  };

  return (
    <div style={{ padding: '16px', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', background: 'hsl(var(--bg-card))', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <input className="form-input" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Team name, e.g. UX/UI" />
      <input className="form-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
      {templateRows.map(row => (
        <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 96px auto', gap: '8px' }}>
          <select className="form-select" value={row.templateName} onChange={(event) => setTemplateRows(rows => rows.map(item => item.id === row.id ? { ...item, templateName: event.target.value } : item))}>
            {agentPersonaTemplates.map(templateOption => <option key={templateOption.name} value={templateOption.name}>{templateOption.name}</option>)}
          </select>
          <select className="form-select" value={row.count} onChange={(event) => setTemplateRows(rows => rows.map(item => item.id === row.id ? { ...item, count: Number(event.target.value) } : item))}>
            {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="button" className="btn-secondary" onClick={() => setTemplateRows(rows => rows.filter(item => item.id !== row.id))} disabled={templateRows.length === 1}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => setTemplateRows(rows => [...rows, { id: crypto.randomUUID(), templateName: agentPersonaTemplates[0]?.name || '', count: 1 }])}>
        Add Template
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {memberDrafts.map(member => (
          <div key={member.draftId} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
            <input className="form-input" value={member.name} onChange={(event) => updateDraft(member.draftId, { name: event.target.value })} />
            <input className="form-input" value={member.role} onChange={(event) => updateDraft(member.draftId, { role: event.target.value })} />
            <input className="form-input" value={member.personaAngle} onChange={(event) => updateDraft(member.draftId, { personaAngle: event.target.value, systemPrompt: member.systemPrompt.replace(member.personaAngle, event.target.value) })} />
            <input className="form-input" value={member.skills.join(', ')} onChange={(event) => updateDraft(member.draftId, { skills: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} />
            <select className="form-select" value={member.provider} onChange={(event) => updateDraft(member.draftId, { provider: event.target.value })}>
              {['gemini', 'openai', 'anthropic'].map(provider => <option key={provider} value={provider}>{provider}</option>)}
            </select>
            <input className="form-input" value={member.model || ''} onChange={(event) => updateDraft(member.draftId, { model: event.target.value || undefined })} placeholder="Model" />
          </div>
        ))}
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
              await onCreate({ name: teamName.trim(), description: description.trim() || undefined }, memberDrafts, []);
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
await api.createTeamWithMembers(projectPath, team, members, skillDrafts);
await loadProjectData(projectPath);
setShowCreateTeam(false);
```

Add `projectPath`, `loadProjectData`, and `api` wiring as needed.

- [ ] **Step 4: Add TeamDetailScreen route**

Create `TeamDetailScreen.tsx` with member ordering and membership controls:

- Reorder saved team members with up/down controls and persist through `api.updateTeamMembers(projectPath, team.id, nextMemberIds)`.
- Add existing saved members from Unassigned or another team by appending their `member.id`.
- Add new template-generated members by opening the same `CreateTeamWizard` member draft editor in add-to-existing mode, calling `api.createTeamWithMembers` only for the new member files and then `api.updateTeamMembers` with existing plus new IDs.
- Remove a member from this team by removing only the ID reference; do not delete the member file.
- Edit a member by opening `Agent:<member.id>` or another ID-backed editor route, not by display name.

```tsx
import React from 'react';

interface TeamDetailScreenProps {
  projectPath: string;
  team: { id: string; name: string; memberIds: string[]; members: Array<{ id: string; name: string }> };
  availableMembers: Array<{ id: string; name: string }>;
  api: { updateTeamMembers: (projectPath: string, teamId: string, memberIds: string[]) => Promise<unknown> };
  reloadProjectData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
}

export const TeamDetailScreen: React.FC<TeamDetailScreenProps> = ({ projectPath, team, availableMembers, api, reloadProjectData, setActiveTab }) => {
  const [selectedMemberId, setSelectedMemberId] = React.useState('');
  const persistMemberIds = async (memberIds: string[]) => {
    await api.updateTeamMembers(projectPath, team.id, memberIds);
    await reloadProjectData();
  };
  const moveMember = async (memberId: string, direction: -1 | 1) => {
    const currentIndex = team.memberIds.indexOf(memberId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= team.memberIds.length) return;
    const nextIds = [...team.memberIds];
    [nextIds[currentIndex], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[currentIndex]];
    await persistMemberIds(nextIds);
  };
  const appendExistingMember = async () => {
    if (!selectedMemberId || team.memberIds.includes(selectedMemberId)) return;
    await persistMemberIds([...team.memberIds, selectedMemberId]);
    setSelectedMemberId('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <button type="button" className="btn-secondary" onClick={() => setActiveTab('AI Members')} style={{ alignSelf: 'flex-start' }}>
        Back to Teams
      </button>
      <h2 style={{ color: 'white' }}>{team.name}</h2>
      <div style={{ display: 'flex', gap: '8px' }}>
        <select className="form-select" value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
          <option value="">Add existing member</option>
          {availableMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <button type="button" className="btn-secondary" onClick={appendExistingMember} disabled={!selectedMemberId}>Add</button>
        <button type="button" className="btn-secondary" onClick={() => setActiveTab(`TeamAddTemplate:${team.id}`)}>Add Template</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {team.members.map((member, index) => (
          <div key={member.id} style={{ padding: '10px 12px', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', background: 'hsl(var(--bg-card))', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '8px', alignItems: 'center' }}>
            <span>{index + 1}. {member.name}</span>
            <button type="button" className="btn-secondary" onClick={() => moveMember(member.id, -1)} disabled={index === 0}>Up</button>
            <button type="button" className="btn-secondary" onClick={() => moveMember(member.id, 1)} disabled={index === team.members.length - 1}>Down</button>
            <button type="button" className="btn-secondary" onClick={() => setActiveTab(`Agent:${member.id}`)}>Edit</button>
            <button type="button" className="btn-secondary" onClick={() => persistMemberIds(team.memberIds.filter(id => id !== member.id))}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
};
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
- Produces: `selectedMemberIds` for saved members and `selectedTemporaryAgentIds` for temporary agents.
- Produces: selected discussion participant names resolved only at submit time from selected IDs.

- [ ] **Step 1: Create DiscussionTeamSelector**

Create `DiscussionTeamSelector.tsx`:

```tsx
import React from 'react';

interface DiscussionTeamSelectorProps {
  teams: Array<{ id: string; name: string; members: Array<{ id: string; name: string }> }>;
  selectedMemberIds: string[];
  setSelectedMemberIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export const DiscussionTeamSelector: React.FC<DiscussionTeamSelectorProps> = ({ teams, selectedMemberIds, setSelectedMemberIds }) => {
  const [expandedTeamIds, setExpandedTeamIds] = React.useState<Record<string, boolean>>({});

  const addTeam = (team: { members: Array<{ id: string }> }) => {
    setSelectedMemberIds(prev => {
      const next = [...prev];
      for (const member of team.members) {
        if (!next.includes(member.id)) next.push(member.id);
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
                const selected = selectedMemberIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                    onClick={() => setSelectedMemberIds(prev => selected ? prev.filter(id => id !== member.id) : [...prev, member.id])}
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

- [ ] **Step 3: Resolve IDs to execution names at submit time**

In `DiscussionsScreen`, keep saved and temporary selection state separate:

```tsx
const [selectedDiscussionMemberIds, setSelectedDiscussionMemberIds] = React.useState<string[]>([]);
const [selectedTemporaryDiscussionAgentIds, setSelectedTemporaryDiscussionAgentIds] = React.useState<string[]>([]);
```

Pass `selectedDiscussionMemberIds` to `DiscussionTeamSelector`. `AgentClonePicker` should add temporary agents with a generated `temporaryAgent.id`, and its selected chips should toggle `selectedTemporaryDiscussionAgentIds`.

In `useDiscussion`, derive engine-compatible names immediately before calling discussion IPC:

```ts
const memberById = new Map(
  (projectData?.agents || [])
    .filter((agent: { id?: string; isVirtual?: boolean }) => agent.id && !agent.isVirtual)
    .map((agent: { id?: string; name: string }) => [agent.id as string, agent])
);
const temporaryAgentById = new Map(temporaryDiscussionAgents.map(agent => [agent.id, agent]));
const selectedSavedNames = selectedDiscussionMemberIds
  .map(memberId => memberById.get(memberId)?.name)
  .filter((name): name is string => Boolean(name));
const selectedTemporaryNames = selectedTemporaryDiscussionAgentIds
  .map(tempId => temporaryAgentById.get(tempId)?.name)
  .filter((name): name is string => Boolean(name));
const validSelectedAgentNames = [...selectedSavedNames, ...selectedTemporaryNames];
```

The UI must dedupe saved participants by member ID and temporary participants by temporary ID. It must never dedupe saved members by display name. Runtime v1 still sends `validSelectedAgentNames` plus `temporaryDiscussionAgents` to the existing engine path.

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
