import type { MemberTeam } from '../../../types/domain.js';

export interface RosterMember {
  id?: string;
  name: string;
  role: string;
  isVirtual?: boolean;
}

export interface TeamRoster {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  members: RosterMember[];
  virtual?: boolean;
}

function isRealMember(member: RosterMember): member is RosterMember & { id: string } {
  return !member.isVirtual && typeof member.id === 'string' && member.id.length > 0;
}

export function dedupeMemberIdsInOrder(memberIds: string[]): string[] {
  const seen = new Set<string>();
  return memberIds.filter(id => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

export function buildTeamRosters(
  agents: RosterMember[],
  teams: MemberTeam[] = [],
  unassignedMemberIds: string[] = []
): { userTeams: TeamRoster[]; unassigned: TeamRoster } {
  const savedAgentsById = new Map<string, RosterMember>();

  for (const agent of agents) {
    if (isRealMember(agent)) {
      savedAgentsById.set(agent.id, agent);
    }
  }

  const userTeams = teams.map(team => {
    const memberIds = dedupeMemberIdsInOrder(team.memberIds ?? []);
    const members = memberIds
      .map(id => savedAgentsById.get(id))
      .filter((member): member is RosterMember => member !== undefined);

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      memberIds,
      members
    };
  });

  const unassignedIds = dedupeMemberIdsInOrder(unassignedMemberIds).filter(id => savedAgentsById.has(id));
  const unassignedMembers = unassignedIds
    .map(id => savedAgentsById.get(id))
    .filter((member): member is RosterMember => member !== undefined);

  return {
    userTeams,
    unassigned: {
      id: 'unassigned',
      name: 'Unassigned',
      memberIds: unassignedIds,
      members: unassignedMembers,
      virtual: true
    }
  };
}
