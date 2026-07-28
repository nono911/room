import type { AgentConfig } from '../agents/registry.js';

export interface DiscussionParticipants {
  participants: AgentConfig[];
  persistedParticipants: AgentConfig[];
}

export function resolveDiscussionParticipants(
  persistedAgents: AgentConfig[],
  temporaryAgents: AgentConfig[],
  requestedNames: string[]
): DiscussionParticipants {
  const available = [...temporaryAgents, ...persistedAgents];
  const names = Array.from(new Map(
    requestedNames
      .map(name => name.trim())
      .filter(Boolean)
      .map(name => [name.toLowerCase(), name])
  ).values());
  const participants = names
    .map(name => available.find(agent => agent.name.toLowerCase() === name.toLowerCase()))
    .filter((agent): agent is AgentConfig => Boolean(agent));
  const persistedSet = new Set(persistedAgents);
  return {
    participants,
    persistedParticipants: participants.filter(agent => persistedSet.has(agent))
  };
}
