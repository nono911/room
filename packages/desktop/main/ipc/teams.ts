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

function serializeTeamStoreError(
  error: unknown
): { success: false; error: string; rollbackWarnings?: string[] } {
  if (error instanceof TeamStoreTransactionError) {
    return {
      success: false,
      error: error.message,
      rollbackWarnings: error.rollbackWarnings
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : String(error)
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
  return { success: true, value };
}

export function registerTeamsIpc(): void {
  ipcMain.handle('load-teams', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      const result = await loadTeamsWithDiagnostics(projectRoot);
      return { success: true, teams: result.teams, diagnostics: result.diagnostics };
    } catch (error) {
      return serializeTeamStoreError(error);
    }
  });

  ipcMain.handle('save-team', async (_event, { dirPath, team }: { dirPath: string; team: unknown }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      return { success: true, team: await saveTeam(projectRoot, team) };
    } catch (error) {
      return serializeTeamStoreError(error);
    }
  });

  ipcMain.handle('delete-team', async (_event, { dirPath, teamId }: { dirPath: string; teamId: string }) => {
    try {
      const projectRoot = requireProjectRootForTeams(dirPath);
      await deleteTeam(projectRoot, teamId);
      return { success: true };
    } catch (error) {
      return serializeTeamStoreError(error);
    }
  });

  ipcMain.handle(
    'update-team-members',
    async (_event, { dirPath, teamId, memberIds }: { dirPath: string; teamId: string; memberIds: unknown }) => {
      try {
        const projectRoot = requireProjectRootForTeams(dirPath);
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
        dirPath,
        team,
        members,
        skillDrafts
      }: {
        dirPath: string;
        team: unknown;
        members: unknown[];
        skillDrafts?: SkillDraft[];
      }
    ) => {
      try {
        const parsedMembers = readTransactionArrayField(members, 'members');
        if (!parsedMembers.success) {
          return { success: false, error: parsedMembers.error };
        }
        const parsedSkillDrafts = readTransactionArrayField(skillDrafts, 'skillDrafts', { optional: true });
        if (!parsedSkillDrafts.success) {
          return { success: false, error: parsedSkillDrafts.error };
        }
        const projectRoot = requireProjectRootForTeams(dirPath);
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
        dirPath,
        teamId,
        members,
        skillDrafts
      }: {
        dirPath: string;
        teamId: string;
        members: unknown[];
        skillDrafts?: SkillDraft[];
      }
    ) => {
      try {
        const parsedMembers = readTransactionArrayField(members, 'members');
        if (!parsedMembers.success) {
          return { success: false, error: parsedMembers.error };
        }
        const parsedSkillDrafts = readTransactionArrayField(skillDrafts, 'skillDrafts', { optional: true });
        if (!parsedSkillDrafts.success) {
          return { success: false, error: parsedSkillDrafts.error };
        }
        const projectRoot = requireProjectRootForTeams(dirPath);
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
