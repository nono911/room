export interface TaskParticipantAgent {
  id?: string;
  name: string;
  role?: string;
}

export interface TaskParticipantEntry<T extends TaskParticipantAgent = TaskParticipantAgent> {
  agent: T;
  ref: string;
}

export function taskParticipantEntries<T extends TaskParticipantAgent>(
  persistedAgents: readonly T[],
  temporaryAgents: readonly T[]
): Array<TaskParticipantEntry<T>> {
  return [
    ...persistedAgents.map(agent => toEntry(agent, 'member')),
    ...temporaryAgents.map(agent => toEntry(agent, 'tmp'))
  ].filter((entry): entry is TaskParticipantEntry<T> => Boolean(entry));
}

export function taskParticipantName(
  reference: string,
  entries: readonly TaskParticipantEntry[]
): string {
  return entries.find(entry => entry.ref === reference)?.agent.name || reference;
}

function toEntry<T extends TaskParticipantAgent>(
  agent: T,
  kind: 'member' | 'tmp'
): TaskParticipantEntry<T> | null {
  if (!agent.id || !/^[a-z0-9][a-z0-9_-]{2,80}$/.test(agent.id)) return null;
  return { agent, ref: `${kind}:${agent.id}` };
}
