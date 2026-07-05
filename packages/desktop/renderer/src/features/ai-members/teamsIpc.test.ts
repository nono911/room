// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (...args: any[]) => Promise<unknown>>();
const {
  requireProjectRootForTeams,
  createTeamWithMembers,
  addMembersToTeam
} = vi.hoisted(() => ({
  requireProjectRootForTeams: vi.fn(() => '/workspace'),
  createTeamWithMembers: vi.fn(),
  addMembersToTeam: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    })
  }
}));

vi.mock('../../../../main/ipc/team-store.js', () => ({
  addMembersToTeam,
  createTeamWithMembers,
  deleteTeam: vi.fn(),
  loadTeamsWithDiagnostics: vi.fn(),
  requireProjectRootForTeams,
  saveTeam: vi.fn(),
  TeamStoreTransactionError: class TeamStoreTransactionError extends Error {
    rollbackWarnings: string[];

    constructor(message: string, rollbackWarnings: string[]) {
      super(message);
      this.rollbackWarnings = rollbackWarnings;
    }
  },
  updateTeamMembers: vi.fn()
}));

import { registerTeamsIpc } from '../../../../main/ipc/teams.js';

describe('registerTeamsIpc transaction payload validation', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    requireProjectRootForTeams.mockClear();
    createTeamWithMembers.mockReset().mockResolvedValue({
      team: { id: 'team_product', name: 'Product', memberIds: [], createdAt: '', updatedAt: '' },
      members: [],
      rollbackWarnings: []
    });
    addMembersToTeam.mockReset().mockResolvedValue({
      team: { id: 'team_product', name: 'Product', memberIds: [], createdAt: '', updatedAt: '' },
      members: [],
      rollbackWarnings: []
    });
    registerTeamsIpc();
  });

  it('rejects malformed members on create-team-with-members instead of coercing to an empty array', async () => {
    const handler = ipcHandlers.get('create-team-with-members');
    expect(handler).toBeTypeOf('function');

    const result = await handler?.({}, {
      dirPath: '/workspace',
      team: { name: 'Product' },
      members: 'bad-members',
      skillDrafts: []
    }) as { success: boolean; error?: string };

    expect(result).toEqual({
      success: false,
      error: 'Transaction field "members" must be an array.'
    });
    expect(createTeamWithMembers).not.toHaveBeenCalled();
  });

  it('rejects malformed skillDrafts on add-members-to-team instead of coercing to an empty array', async () => {
    const handler = ipcHandlers.get('add-members-to-team');
    expect(handler).toBeTypeOf('function');

    const result = await handler?.({}, {
      dirPath: '/workspace',
      teamId: 'team_product',
      members: [],
      skillDrafts: { bad: true }
    }) as { success: boolean; error?: string };

    expect(result).toEqual({
      success: false,
      error: 'Transaction field "skillDrafts" must be an array when provided.'
    });
    expect(addMembersToTeam).not.toHaveBeenCalled();
  });

  it('keeps skillDrafts optional when create-team-with-members omits the field', async () => {
    const handler = ipcHandlers.get('create-team-with-members');
    expect(handler).toBeTypeOf('function');

    const result = await handler?.({}, {
      dirPath: '/workspace',
      team: { name: 'Product' },
      members: []
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);
    expect(createTeamWithMembers).toHaveBeenCalledWith('/workspace', { name: 'Product' }, [], []);
  });
});
