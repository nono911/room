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
