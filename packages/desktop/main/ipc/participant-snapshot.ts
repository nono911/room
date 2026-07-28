import type { AgentConfig } from '@room/engine';

const PARTICIPANT_REF_PATTERN = /^(member|tmp):([a-z0-9][a-z0-9_-]{2,80})$/;

export function resolveParticipantSnapshots(
  persistedAgents: readonly AgentConfig[],
  temporaryAgents: readonly AgentConfig[],
  references: readonly string[]
): {
  participants: AgentConfig[];
  persistedParticipants: AgentConfig[];
} {
  const persistedById = indexAgents(persistedAgents, 'saved');
  const temporaryById = indexAgents(temporaryAgents, 'temporary');
  const seen = new Set<string>();
  const participants: AgentConfig[] = [];
  const persistedParticipants: AgentConfig[] = [];
  for (const reference of references) {
    const match = reference.match(PARTICIPANT_REF_PATTERN);
    if (!match || seen.has(reference)) {
      throw new Error('Invalid AI member reference.');
    }
    seen.add(reference);
    const agent = match[1] === 'member'
      ? persistedById.get(match[2])
      : temporaryById.get(match[2]);
    if (!agent) throw new Error('Selected AI member is unavailable.');
    participants.push(agent);
    if (match[1] === 'member') persistedParticipants.push(agent);
  }
  return { participants, persistedParticipants };
}

export function resolveOptionalParticipantSnapshot(
  persistedAgents: readonly AgentConfig[],
  temporaryAgents: readonly AgentConfig[],
  reference: string | undefined
): AgentConfig | undefined {
  if (!reference) return undefined;
  return resolveParticipantSnapshots(
    persistedAgents,
    temporaryAgents,
    [reference]
  ).participants[0];
}

export function pickRoleParticipant(
  agents: readonly AgentConfig[],
  terms: readonly string[]
): AgentConfig | undefined {
  return agents.find(agent => {
    const description = `${agent.name} ${agent.role}`.toLowerCase();
    return terms.some(term => description.includes(term));
  }) || agents[0];
}

function indexAgents(
  agents: readonly AgentConfig[],
  label: string
): Map<string, AgentConfig> {
  const indexed = new Map<string, AgentConfig>();
  for (const agent of agents) {
    if (!agent.id || !/^[a-z0-9][a-z0-9_-]{2,80}$/.test(agent.id)) {
      throw new Error(`${label} AI members require stable IDs.`);
    }
    if (indexed.has(agent.id)) {
      throw new Error(`${label} AI member IDs must be unique.`);
    }
    indexed.set(agent.id, { ...agent, skills: [...(agent.skills || [])] });
  }
  return indexed;
}
