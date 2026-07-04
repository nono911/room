import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { validateAgentConfig, type AgentConfig } from '@room/engine';
import type { MemberTeam } from '../../shared/types/domain.js';
import {
  ROOM_DIR,
  requireBoundProjectRoot,
  resolveWithinProject,
  sanitizeFileName
} from './shared.js';

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

export class TeamStoreTransactionError extends Error {
  constructor(message: string, readonly rollbackWarnings: string[]) {
    super(message);
    this.name = 'TeamStoreTransactionError';
  }
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

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function parseMemberIds(rawIds: unknown): { success: true; memberIds: string[] } | { success: false; error: string } {
  if (!Array.isArray(rawIds)) return { success: true, memberIds: [] };

  const seen = new Set<string>();
  const memberIds: string[] = [];

  for (const rawId of rawIds) {
    if (typeof rawId !== 'string') {
      return { success: false, error: 'Team memberIds must contain only strings.' };
    }

    const memberId = rawId.trim();
    if (!MEMBER_ID_PATTERN.test(memberId)) {
      return { success: false, error: `Invalid member id: ${memberId}` };
    }

    if (seen.has(memberId)) continue;
    seen.add(memberId);
    memberIds.push(memberId);
  }

  return { success: true, memberIds };
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
  if (!name) {
    return { success: false, error: 'Team name is required.' };
  }

  let id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id && options.allowMissingId) {
    id = createStableId('team', name);
  }
  if (!TEAM_ID_PATTERN.test(id)) {
    return { success: false, error: `Invalid team id: ${id || '(missing)'}` };
  }

  const memberIdsResult = parseMemberIds(record.memberIds);
  if (!memberIdsResult.success) {
    return memberIdsResult;
  }

  const now = new Date().toISOString();
  const createdAt = normalizeTimestamp(record.createdAt, now);
  const updatedAt = normalizeTimestamp(record.updatedAt, createdAt);

  return {
    success: true,
    team: {
      id,
      name,
      description: normalizeOptionalText(record.description),
      memberIds: memberIdsResult.memberIds,
      createdAt,
      updatedAt
    }
  };
}

function ensureSkillDrafts(skillDrafts: SkillDraft[]): void {
  for (const skill of skillDrafts) {
    if (!skill.name.trim()) {
      throw new Error('Skill draft name is required.');
    }
    if (!skill.content.trim()) {
      throw new Error(`Skill draft ${skill.name} is empty.`);
    }
  }
}

function validateMemberPayloads(rawMembers: unknown[]): AgentConfig[] {
  const members = rawMembers.map((rawMember) => {
    const memberRecord = rawMember && typeof rawMember === 'object'
      ? rawMember as Record<string, unknown>
      : {};
    const id = typeof memberRecord.id === 'string'
      ? memberRecord.id.trim()
      : createStableId('mem', String(memberRecord.name || 'member'));

    if (!MEMBER_ID_PATTERN.test(id)) {
      throw new Error(`Invalid member id: ${id}`);
    }

    const result = validateAgentConfig({ ...memberRecord, id });
    if (!result.success) {
      throw new Error(result.error);
    }

    return result.agent;
  });

  const memberIds = members.map((member) => member.id).filter((id): id is string => Boolean(id));
  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error('Duplicate member ids in team payload.');
  }

  return members;
}

async function reserveAndWriteFiles(
  writes: Array<{ finalPath: string; content: string }>
): Promise<{ rollbackWarnings: string[]; writtenPaths: string[] }> {
  if (new Set(writes.map((write) => write.finalPath)).size !== writes.length) {
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

    return { rollbackWarnings, writtenPaths: writes.map((write) => write.finalPath) };
  } catch (error) {
    for (const filePath of [...new Set([...completedFiles, ...reservedFiles, ...tempFiles])]) {
      try {
        await fs.unlink(filePath);
      } catch {
        rollbackWarnings.push(filePath);
      }
    }

    throw new TeamStoreTransactionError(
      error instanceof Error ? error.message : String(error),
      rollbackWarnings
    );
  }
}

export function validateNewTeamDraft(
  rawTeam: unknown
): { success: true; team: MemberTeam } | { success: false; error: string } {
  return validateTeamShape(rawTeam, { allowMissingId: true });
}

export function validatePersistedTeamConfig(
  rawTeam: unknown
): { success: true; team: MemberTeam } | { success: false; error: string } {
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
      if (validated.success) {
        teams.push(validated.team);
      } else {
        diagnostics.push({ filePath, error: validated.error });
      }
    } catch (error) {
      diagnostics.push({
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    teams: teams.sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics
  };
}

export async function loadTeams(projectRoot: string): Promise<MemberTeam[]> {
  const result = await loadTeamsWithDiagnostics(projectRoot);
  return result.teams;
}

export async function saveTeam(projectRoot: string, rawTeam: unknown): Promise<MemberTeam> {
  const validated = validateNewTeamDraft(rawTeam);
  if (!validated.success) {
    throw new Error(validated.error);
  }

  const teamsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'teams');
  await fs.mkdir(teamsDir, { recursive: true });

  const now = new Date().toISOString();
  const team: MemberTeam = {
    ...validated.team,
    createdAt: normalizeTimestamp((rawTeam as Record<string, unknown>)?.createdAt, now),
    updatedAt: now
  };
  const filePath = resolveWithinProject(
    teamsDir,
    `${sanitizeFileName(team.id, 'team')}.json`
  );

  await fs.writeFile(filePath, JSON.stringify(team, null, 2), 'utf-8');
  return team;
}

export async function deleteTeam(projectRoot: string, teamId: string): Promise<void> {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error('Invalid team id.');
  }

  const safeId = sanitizeFileName(teamId, 'team');
  await fs.unlink(resolveWithinProject(projectRoot, ROOM_DIR, 'teams', `${safeId}.json`));
}

export async function updateTeamMembers(
  projectRoot: string,
  teamId: string,
  memberIds: unknown
): Promise<MemberTeam> {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error('Invalid team id.');
  }

  const parsedMemberIds = parseMemberIds(memberIds);
  if (!parsedMemberIds.success) {
    throw new Error(parsedMemberIds.error);
  }

  const teams = await loadTeams(projectRoot);
  const current = teams.find((team) => team.id === teamId);
  if (!current) {
    throw new Error('Team not found.');
  }

  return saveTeam(projectRoot, {
    ...current,
    memberIds: parsedMemberIds.memberIds
  });
}

export async function removeMemberFromTeams(projectRoot: string, memberId: string): Promise<void> {
  const teams = await loadTeams(projectRoot);

  for (const team of teams) {
    if (!team.memberIds.includes(memberId)) continue;

    await saveTeam(projectRoot, {
      ...team,
      memberIds: team.memberIds.filter((id) => id !== memberId)
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
  if (!teamResult.success) {
    throw new Error(teamResult.error);
  }

  const members = validateMemberPayloads(rawMembers);
  const memberIds = members.map((member) => member.id).filter((id): id is string => Boolean(id));
  const team: MemberTeam = {
    ...teamResult.team,
    memberIds,
    updatedAt: new Date().toISOString()
  };

  const membersDir = resolveWithinProject(projectRoot, ROOM_DIR, 'members');
  const teamsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'teams');
  const skillsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'skills');

  await fs.mkdir(membersDir, { recursive: true });
  await fs.mkdir(teamsDir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });
  ensureSkillDrafts(skillDrafts);

  const writes = [
    ...members.map((member) => ({
      finalPath: resolveWithinProject(membersDir, `${member.id}.json`),
      content: JSON.stringify(member, null, 2)
    })),
    {
      finalPath: resolveWithinProject(teamsDir, `${sanitizeFileName(team.id, 'team')}.json`),
      content: JSON.stringify(team, null, 2)
    },
    ...skillDrafts.map((skill) => ({
      finalPath: resolveWithinProject(skillsDir, `${sanitizeFileName(skill.name, 'skill')}.md`),
      content: skill.content
    }))
  ];

  const { rollbackWarnings } = await reserveAndWriteFiles(writes);
  return { team, members, rollbackWarnings };
}

export async function addMembersToTeam(
  projectRoot: string,
  teamId: string,
  rawMembers: unknown[],
  skillDrafts: SkillDraft[] = []
): Promise<{ team: MemberTeam; members: AgentConfig[]; rollbackWarnings: string[] }> {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error('Invalid team id.');
  }

  const teams = await loadTeams(projectRoot);
  const current = teams.find((team) => team.id === teamId);
  if (!current) {
    throw new Error('Team not found.');
  }

  const members = validateMemberPayloads(rawMembers);
  const newMemberIds = members.map((member) => member.id).filter((id): id is string => Boolean(id));
  const updatedTeam: MemberTeam = {
    ...current,
    memberIds: [...current.memberIds, ...newMemberIds.filter((id) => !current.memberIds.includes(id))],
    updatedAt: new Date().toISOString()
  };

  const membersDir = resolveWithinProject(projectRoot, ROOM_DIR, 'members');
  const teamsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'teams');
  const skillsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'skills');

  await fs.mkdir(membersDir, { recursive: true });
  await fs.mkdir(teamsDir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });
  ensureSkillDrafts(skillDrafts);

  const memberWrites = members.map((member) => ({
    finalPath: resolveWithinProject(membersDir, `${member.id}.json`),
    content: JSON.stringify(member, null, 2)
  }));
  const skillWrites = skillDrafts.map((skill) => ({
    finalPath: resolveWithinProject(skillsDir, `${sanitizeFileName(skill.name, 'skill')}.md`),
    content: skill.content
  }));

  const teamPath = resolveWithinProject(teamsDir, `${sanitizeFileName(teamId, 'team')}.json`);
  const { rollbackWarnings, writtenPaths } = await reserveAndWriteFiles([...memberWrites, ...skillWrites]);
  const teamTempPath = `${teamPath}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(teamTempPath, JSON.stringify(updatedTeam, null, 2), { encoding: 'utf-8', flag: 'wx' });
    await fs.rename(teamTempPath, teamPath);
    return { team: updatedTeam, members, rollbackWarnings };
  } catch (error) {
    const cleanupWarnings = [...rollbackWarnings];
    for (const filePath of [...writtenPaths, teamTempPath]) {
      try {
        await fs.unlink(filePath);
      } catch {
        cleanupWarnings.push(filePath);
      }
    }

    throw new TeamStoreTransactionError(
      error instanceof Error ? error.message : String(error),
      cleanupWarnings
    );
  }
}

export function requireProjectRootForTeams(dirPath: string): string {
  return requireBoundProjectRoot(dirPath);
}
