import * as fs from 'fs/promises';
import {
  readRoomTextFile,
  withRoomMemberMutation,
  withRoomStorageReconciliation,
  withRoomStorageTransaction,
  type AgentConfig
} from '@room/engine';
import type { MemberTeam } from '../../shared/types/domain.js';
import {
  requireBoundRoom,
  requireBoundRoomWorkspace,
  resolveWithinRoomData,
  sanitizeFileName,
  safeReadDirWithStatus
} from './shared.js';
import { writeRoomDataFileAtomically } from './room-file-write.js';
import {
  executeDurableTeamTransaction
} from './team-store-transaction.js';
import { assertNoPendingMemberDeletions } from './member-tombstone.js';
import {
  MAX_ROOM_TEAMS,
  MAX_TEAM_AGGREGATE_BYTES,
  MAX_TEAM_FILE_BYTES,
  withTeamMutation
} from './team-store-limits.js';
import {
  normalizeTimestamp,
  parseMemberIds,
  TEAM_ID_PATTERN,
  validateMemberPayloads,
  validateNewTeamDraft,
  validatePersistedTeamConfig
} from './team-store-validation.js';

export { TeamStoreTransactionError } from './team-store-transaction.js';
export { createStableId } from './team-store-validation.js';

export interface TeamStoreDiagnostic { filePath: string; error: string }
export interface LoadTeamsResult {
  teams: MemberTeam[];
  diagnostics: TeamStoreDiagnostic[];
}
export interface SkillDraft {
  name: string;
  content: string;
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

export async function loadTeamsWithDiagnostics(projectRoot: string): Promise<LoadTeamsResult> {
  const teamsDir = resolveWithinRoomData(projectRoot, 'teams');
  let entries: string[] = [];

  try {
    const listing = await safeReadDirWithStatus(teamsDir, 1_000);
    entries = listing.files;
    if (listing.truncated) {
      return {
        teams: [],
        diagnostics: [{
          filePath: teamsDir,
          error: 'ROOM team directory exceeds its entry limit.'
        }]
      };
    }
    const teamFiles = entries.filter(entry => entry.endsWith('.json'));
    if (teamFiles.length > MAX_ROOM_TEAMS) {
      return {
        teams: [],
        diagnostics: [{
          filePath: teamsDir,
          error: `A Room can contain at most ${MAX_ROOM_TEAMS} teams.`
        }]
      };
    }
  } catch {
    return { teams: [], diagnostics: [] };
  }

  const teams: MemberTeam[] = [];
  const diagnostics: TeamStoreDiagnostic[] = [];
  let aggregateBytes = 0;

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;

    const filePath = resolveWithinRoomData(projectRoot, 'teams', entry);
    try {
      const fileStat = await fs.lstat(filePath);
      if (
        !fileStat.isFile()
        || fileStat.isSymbolicLink()
        || fileStat.size > MAX_TEAM_FILE_BYTES
      ) {
        throw new Error('ROOM team file exceeds its read limit.');
      }
      if (aggregateBytes + fileStat.size > MAX_TEAM_AGGREGATE_BYTES) {
        diagnostics.push({
          filePath: teamsDir,
          error: 'ROOM team data exceeds its aggregate read limit.'
        });
        break;
      }
      const content = await readRoomTextFile(
        requireBoundRoomWorkspace(projectRoot),
        ['teams', entry],
        MAX_TEAM_FILE_BYTES
      );
      aggregateBytes += Buffer.byteLength(content, 'utf-8');
      if (aggregateBytes > MAX_TEAM_AGGREGATE_BYTES) {
        throw new Error('ROOM team data exceeds its aggregate read limit.');
      }
      const raw = JSON.parse(content);
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

  const teamsDir = resolveWithinRoomData(projectRoot, 'teams');
  await fs.mkdir(teamsDir, { recursive: true });

  const now = new Date().toISOString();
  const team: MemberTeam = {
    ...validated.team,
    createdAt: normalizeTimestamp((rawTeam as Record<string, unknown>)?.createdAt, now),
    updatedAt: now
  };
  const filename = `${sanitizeFileName(team.id, 'team')}.json`;
  await withTeamMutation(
    projectRoot,
    [filename],
    () => writeTeamUnlocked(projectRoot, team)
  );
  return team;
}

export async function deleteTeam(projectRoot: string, teamId: string): Promise<void> {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error('Invalid team id.');
  }

  const safeId = sanitizeFileName(teamId, 'team');
  const filename = `${safeId}.json`;
  await withTeamMutation(projectRoot, [filename], () =>
    withRoomStorageReconciliation(
      requireBoundRoomWorkspace(projectRoot),
      () => fs.unlink(resolveWithinRoomData(projectRoot, 'teams', filename))
    )
  );
}

export async function updateTeamMembers(
  projectRoot: string,
  teamId: string,
  memberIds: unknown
): Promise<MemberTeam> {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error('Invalid team id.');
  }

  const parsedMemberIds = parseMemberIds(memberIds, { requireArray: true });
  if (!parsedMemberIds.success) {
    throw new Error(parsedMemberIds.error);
  }

  const filename = `${sanitizeFileName(teamId, 'team')}.json`;
  return withTeamMutation(projectRoot, [filename], async () => {
    const current = (await loadTeams(projectRoot)).find(team => team.id === teamId);
    if (!current) throw new Error('Team not found.');
    const updated = {
      ...current,
      memberIds: parsedMemberIds.memberIds,
      updatedAt: new Date().toISOString()
    };
    await writeTeamUnlocked(projectRoot, updated);
    return updated;
  });
}

export async function removeMemberFromTeams(projectRoot: string, memberId: string): Promise<void> {
  await withTeamMutation(projectRoot, [], async () => {
    const teams = await loadTeams(projectRoot);
    for (const team of teams) {
      if (!team.memberIds.includes(memberId)) continue;
      await writeTeamUnlocked(projectRoot, {
        ...team,
        memberIds: team.memberIds.filter(id => id !== memberId),
        updatedAt: new Date().toISOString()
      });
    }
  });
}

export async function assertMemberTeamCleanupReadable(
  roomId: string
): Promise<void> {
  const result = await loadTeamsWithDiagnostics(roomId);
  if (result.diagnostics.length > 0) {
    throw new Error('ROOM team data must be repaired before deleting this member.');
  }
}

async function writeTeamUnlocked(roomId: string, team: MemberTeam): Promise<void> {
  await writeRoomDataFileAtomically(
    roomId,
    ['teams', `${sanitizeFileName(team.id, 'team')}.json`],
    JSON.stringify(team, null, 2)
  );
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

  const membersDir = resolveWithinRoomData(projectRoot, 'members');
  const teamsDir = resolveWithinRoomData(projectRoot, 'teams');
  const rolesDir = resolveWithinRoomData(projectRoot, 'roles');

  await fs.mkdir(membersDir, { recursive: true });
  await fs.mkdir(teamsDir, { recursive: true });
  await fs.mkdir(rolesDir, { recursive: true });
  ensureSkillDrafts(skillDrafts);

  const writes = [
    ...members.map((member) => ({
      parts: ['members', `${member.id}.json`] as const,
      content: JSON.stringify(member, null, 2),
      mode: 'create' as const
    })),
    ...skillDrafts.map((skill) => ({
      parts: ['roles', `${sanitizeFileName(skill.name, 'skill')}.md`] as const,
      content: skill.content,
      mode: 'create' as const
    })),
    {
      parts: ['teams', `${sanitizeFileName(team.id, 'team')}.json`] as const,
      content: JSON.stringify(team, null, 2),
      mode: 'create' as const
    }
  ];

  const memberFilenames = members.map(member => `${member.id}.json`);
  const teamFilename = `${sanitizeFileName(team.id, 'team')}.json`;
  const { rollbackWarnings } = await withRoomMemberMutation(
    requireBoundRoomWorkspace(projectRoot),
    memberFilenames,
    async () => {
      await assertNoPendingMemberDeletions(projectRoot, memberIds);
      return withTeamMutation(projectRoot, [teamFilename], () =>
        withRoomStorageTransaction(
          requireBoundRoomWorkspace(projectRoot),
          async () => ({
            bytes: writes.reduce(
              (total, write) => total + Buffer.byteLength(write.content, 'utf-8'),
              0
            ),
            entries: writes.length
          }),
          () => executeDurableTeamTransaction(
            projectRoot,
            `create-${sanitizeFileName(team.id, 'team')}`,
            writes
          )
        )
      );
    }
  );
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
  const members = validateMemberPayloads(rawMembers);
  const membersDir = resolveWithinRoomData(projectRoot, 'members');
  const teamsDir = resolveWithinRoomData(projectRoot, 'teams');
  const rolesDir = resolveWithinRoomData(projectRoot, 'roles');
  await fs.mkdir(membersDir, { recursive: true });
  await fs.mkdir(teamsDir, { recursive: true });
  await fs.mkdir(rolesDir, { recursive: true });
  ensureSkillDrafts(skillDrafts);
  return withRoomMemberMutation(
    requireBoundRoomWorkspace(projectRoot),
    members.map(member => `${member.id}.json`),
    async () => {
      await assertNoPendingMemberDeletions(
        projectRoot,
        members.map(member => member.id!)
      );
      return withTeamMutation(
        projectRoot,
        [`${sanitizeFileName(teamId, 'team')}.json`],
        () => addMembersToTeamLocked(projectRoot, teamId, members, skillDrafts)
      );
    }
  );
}

async function addMembersToTeamLocked(
  roomId: string,
  teamId: string,
  members: AgentConfig[],
  skillDrafts: SkillDraft[]
): Promise<{ team: MemberTeam; members: AgentConfig[]; rollbackWarnings: string[] }> {
  const current = (await loadTeams(roomId)).find(team => team.id === teamId);
  if (!current) throw new Error('Team not found.');
  const newMemberIds = members
    .map(member => member.id)
    .filter((id): id is string => Boolean(id));
  const updatedTeam: MemberTeam = {
    ...current,
    memberIds: [
      ...current.memberIds,
      ...newMemberIds.filter(id => !current.memberIds.includes(id))
    ],
    updatedAt: new Date().toISOString()
  };
  const memberWrites = members.map(member => ({
    parts: ['members', `${member.id}.json`] as const,
    content: JSON.stringify(member, null, 2),
    mode: 'create' as const
  }));
  const skillWrites = skillDrafts.map(skill => ({
    parts: ['roles', `${sanitizeFileName(skill.name, 'skill')}.md`] as const,
    content: skill.content,
    mode: 'create' as const
  }));
  const teamPath = resolveWithinRoomData(
    roomId,
    'teams',
    `${sanitizeFileName(teamId, 'team')}.json`
  );
  const teamContent = JSON.stringify(updatedTeam, null, 2);
  const newFileBytes = [...memberWrites, ...skillWrites].reduce(
    (total, write) => total + Buffer.byteLength(write.content, 'utf-8'),
    0
  );
  return withRoomStorageTransaction(
    requireBoundRoomWorkspace(roomId),
    async () => {
      const currentTeamBytes = await fs.lstat(teamPath)
        .then(stat => stat.isFile() ? stat.size : 0)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return 0;
          throw error;
        });
      return {
        bytes: newFileBytes + Buffer.byteLength(teamContent, 'utf-8') - currentTeamBytes,
        entries: memberWrites.length + skillWrites.length
      };
    },
    async () => {
      const { rollbackWarnings } = await executeDurableTeamTransaction(
        roomId,
        `add-${sanitizeFileName(teamId, 'team')}`,
        [
          ...memberWrites,
          ...skillWrites,
          {
            parts: ['teams', `${sanitizeFileName(teamId, 'team')}.json`],
            content: teamContent,
            mode: 'replace'
          }
        ]
      );
      return { team: updatedTeam, members, rollbackWarnings };
    }
  );
}

export function requireProjectRootForTeams(roomId: string): string {
  requireBoundRoom(roomId);
  return roomId;
}
