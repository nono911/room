import { ipcMain } from 'electron';
import {
  addMembersToTeam,
  createTeamWithMembers,
  deleteTeam,
  loadTeamsWithDiagnostics,
  requireProjectRootForTeams,
  saveTeam,
  TeamStoreTransactionError,
  updateTeamMembers
} from './team-store.js';
import type { SkillDraft } from './team-store.js';
import * as path from 'path';
import { assertJsonBytes, IPC_LIMITS } from './ipc-limits.js';
import { hasMachineSkillAssignment } from './machine-skill-grants.js';
import { toPublicError } from './public-error.js';

function serializeTeamStoreError(
  error: unknown
): { success: false; error: string; rollbackWarnings?: string[] } {
  if (error instanceof TeamStoreTransactionError) {
    return {
      success: false,
      error: toPublicError(error, 'ROOM could not save the team transaction.'),
      rollbackWarnings: error.rollbackWarnings.map(warning => path.basename(warning))
    };
  }

  return {
    success: false,
    error: toPublicError(error)
  };
}

function readTransactionArrayField(
  value: unknown,
  fieldName: 'members' | 'skillDrafts',
  options: { optional?: boolean } = {}
): { success: true; value: unknown[] } | { success: false; error: string } {
  if (value === undefined && options.optional) {
    return { success: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return {
      success: false,
      error: fieldName === 'members'
        ? 'Transaction field "members" must be an array.'
        : 'Transaction field "skillDrafts" must be an array when provided.'
    };
  }
  if (value.length > 64) {
    return { success: false, error: `Transaction field "${fieldName}" exceeds 64 items.` };
  }
  return { success: true, value };
}

export function registerTeamsIpc(): void {
  ipcMain.handle('load-teams', async (_event, { roomId }: { roomId: string }) => {
    try {
      const projectRoot = requireProjectRootForTeams(roomId);
      const result = await loadTeamsWithDiagnostics(projectRoot);
      return {
        success: true,
        teams: result.teams,
        diagnostics: result.diagnostics.map(item => ({
          source: path.basename(item.filePath),
          message: 'Team configuration could not be loaded.'
        }))
      };
    } catch (error) {
      return serializeTeamStoreError(error);
    }
  });

  ipcMain.handle('save-team', async (_event, { roomId, team }: { roomId: string; team: unknown }) => {
    try {
      assertJsonBytes(team, 'Team payload', IPC_LIMITS.teamPayloadBytes);
      const projectRoot = requireProjectRootForTeams(roomId);
      return { success: true, team: await saveTeam(projectRoot, team) };
    } catch (error) {
      return serializeTeamStoreError(error);
    }
  });

  ipcMain.handle('delete-team', async (_event, { roomId, teamId }: { roomId: string; teamId: string }) => {
    try {
      const projectRoot = requireProjectRootForTeams(roomId);
      await deleteTeam(projectRoot, teamId);
      return { success: true };
    } catch (error) {
      return serializeTeamStoreError(error);
    }
  });

  ipcMain.handle(
    'update-team-members',
    async (_event, { roomId, teamId, memberIds }: { roomId: string; teamId: string; memberIds: unknown }) => {
      try {
        assertJsonBytes(memberIds, 'Team member update', IPC_LIMITS.teamPayloadBytes);
        const projectRoot = requireProjectRootForTeams(roomId);
        return { success: true, team: await updateTeamMembers(projectRoot, teamId, memberIds) };
      } catch (error) {
        return serializeTeamStoreError(error);
      }
    }
  );

  ipcMain.handle(
    'create-team-with-members',
    async (
      _event,
      {
        roomId,
        team,
        members,
        skillDrafts
      }: {
        roomId: string;
        team: unknown;
        members: unknown[];
        skillDrafts?: SkillDraft[];
      }
    ) => {
      try {
        assertJsonBytes(
          { team, members, skillDrafts },
          'Team transaction',
          IPC_LIMITS.teamPayloadBytes
        );
        const parsedMembers = readTransactionArrayField(members, 'members');
        if (!parsedMembers.success) {
          return { success: false, error: parsedMembers.error };
        }
        if (hasMachineSkillAssignment(parsedMembers.value)) {
          return {
            success: false,
            error: 'Assign machine skills from the AI member editor so ROOM can request native approval.'
          };
        }
        const parsedSkillDrafts = readTransactionArrayField(skillDrafts, 'skillDrafts', { optional: true });
        if (!parsedSkillDrafts.success) {
          return { success: false, error: parsedSkillDrafts.error };
        }
        const projectRoot = requireProjectRootForTeams(roomId);
        return {
          success: true,
          ...(await createTeamWithMembers(
            projectRoot,
            team,
            parsedMembers.value,
            parsedSkillDrafts.value as SkillDraft[]
          ))
        };
      } catch (error) {
        return serializeTeamStoreError(error);
      }
    }
  );

  ipcMain.handle(
    'add-members-to-team',
    async (
      _event,
      {
        roomId,
        teamId,
        members,
        skillDrafts
      }: {
        roomId: string;
        teamId: string;
        members: unknown[];
        skillDrafts?: SkillDraft[];
      }
    ) => {
      try {
        assertJsonBytes(
          { members, skillDrafts },
          'Team transaction',
          IPC_LIMITS.teamPayloadBytes
        );
        const parsedMembers = readTransactionArrayField(members, 'members');
        if (!parsedMembers.success) {
          return { success: false, error: parsedMembers.error };
        }
        if (hasMachineSkillAssignment(parsedMembers.value)) {
          return {
            success: false,
            error: 'Assign machine skills from the AI member editor so ROOM can request native approval.'
          };
        }
        const parsedSkillDrafts = readTransactionArrayField(skillDrafts, 'skillDrafts', { optional: true });
        if (!parsedSkillDrafts.success) {
          return { success: false, error: parsedSkillDrafts.error };
        }
        const projectRoot = requireProjectRootForTeams(roomId);
        return {
          success: true,
          ...(await addMembersToTeam(
            projectRoot,
            teamId,
            parsedMembers.value,
            parsedSkillDrafts.value as SkillDraft[]
          ))
        };
      } catch (error) {
        return serializeTeamStoreError(error);
      }
    }
  );
}
