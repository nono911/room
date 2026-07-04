export interface RosterMember {
  id: string;
  name: string;
  role: string;
  isVirtual?: boolean;
}

export interface MemberTeamLike {
  id: string;
  name: string;
  description?: string;
  memberIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TeamRoster {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  members: RosterMember[];
  virtual?: boolean;
}

function isRealAgent(agent: RosterMember): boolean {
  return !agent.isVirtual && typeof agent.id === 'string' && agent.id.length > 0;
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
  teams: MemberTeamLike[] = [],
  unassignedMemberIds: string[] = []
): { userTeams: TeamRoster[]; unassigned: TeamRoster } {
  const savedAgentsById = new Map<string, RosterMember>();

  for (const agent of agents) {
    if (isRealAgent(agent)) {
      savedAgentsById.set(agent.id, agent);
    }
  }

  const userTeams = teams.map(team => {
    const memberIds = dedupeMemberIdsInOrder(team.memberIds ?? []);
    const members = memberIds
      .map(id => savedAgentsById.get(id))
      .filter((member): member is RosterMember => Boolean(member));

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      memberIds,
      members
    };
  });

  const unassignedIds = dedupeMemberIdsInOrder(unassignedMemberIds).filter(id => savedAgentsById.has(id));

  return {
    userTeams,
    unassigned: {
      id: 'unassigned',
      name: 'Unassigned',
      memberIds: unassignedIds,
      members: unassignedIds
        .map(id => savedAgentsById.get(id))
        .filter((member): member is RosterMember => Boolean(member)),
      virtual: true
    }
  };
}
