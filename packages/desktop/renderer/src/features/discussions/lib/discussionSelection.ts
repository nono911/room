export type PersistedDiscussionAgent = {
  id?: string;
  name: string;
  role?: string;
  isVirtual?: boolean;
};

export type TemporaryDiscussionAgent = {
  id: string;
  name: string;
  role: string;
  provider: string;
  modelName?: string;
  systemPrompt: string;
  skills?: string[];
  command?: string;
  cliPreset?: string;
  stdinFormat?: string;
  permissionMode?: string;
  strategy?: string;
};

export interface ResolveDiscussionSelectionOptions {
  projectAgents: PersistedDiscussionAgent[];
  selectedDiscussionMemberIds: string[];
  selectedLegacyDiscussionAgentNames?: string[];
  temporaryDiscussionAgents: TemporaryDiscussionAgent[];
  selectedTemporaryDiscussionAgentIds: string[];
}

export interface DiscussionSelectionResolution {
  selectedSavedNames: string[];
  selectedLegacyNames: string[];
  selectedTemporaryNames: string[];
  selectedAgentNames: string[];
}

export interface DiscussionSelectionByName {
  selectedDiscussionMemberIds: string[];
  selectedLegacyDiscussionAgentNames: string[];
  selectedTemporaryDiscussionAgentIds: string[];
  unresolvedAgentNames: string[];
}

export function dedupeDiscussionSelectionValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

export function appendUniqueDiscussionSelectionValues(prev: string[], values: string[]): string[] {
  return dedupeDiscussionSelectionValues([...prev, ...values]);
}

export function removeDiscussionSelectionValue(prev: string[], value: string): string[] {
  return prev.filter((entry) => entry !== value);
}

export function reorderDiscussionSelectionValues(prev: string[], sourceIndex: number, targetIndex: number): string[] {
  if (
    sourceIndex < 0
    || targetIndex < 0
    || sourceIndex >= prev.length
    || targetIndex >= prev.length
    || sourceIndex === targetIndex
  ) {
    return prev;
  }

  const next = [...prev];
  const [removed] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, removed);
  return dedupeDiscussionSelectionValues(next);
}

export function areDiscussionSelectionValuesEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function getPersistedDiscussionAgents(projectAgents: PersistedDiscussionAgent[]): PersistedDiscussionAgent[] {
  return projectAgents.filter((agent) => !agent.isVirtual);
}

export function createDiscussionSelectionId(prefix: 'mem' | 'tmp', name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'member';
  const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10)
    || Math.random().toString(36).slice(2, 12);
  return `${prefix}_${slug}_${suffix}`;
}

export function resolveDiscussionSelection({
  projectAgents,
  selectedDiscussionMemberIds,
  selectedLegacyDiscussionAgentNames = [],
  temporaryDiscussionAgents,
  selectedTemporaryDiscussionAgentIds
}: ResolveDiscussionSelectionOptions): DiscussionSelectionResolution {
  const memberById = new Map(
    projectAgents
      .filter((agent): agent is PersistedDiscussionAgent & { id: string } => typeof agent.id === 'string' && agent.id.length > 0)
      .map((agent) => [agent.id, agent])
  );
  const temporaryAgentById = new Map(temporaryDiscussionAgents.map((agent) => [agent.id, agent]));
  const availablePersistedNames = new Set(projectAgents.map((agent) => agent.name));
  const selectedSavedNames = selectedDiscussionMemberIds
    .map((memberId) => memberById.get(memberId)?.name)
    .filter((name): name is string => Boolean(name));
  const selectedLegacyNames = selectedLegacyDiscussionAgentNames
    .filter((name) => availablePersistedNames.has(name));
  const selectedTemporaryNames = selectedTemporaryDiscussionAgentIds
    .map((temporaryId) => temporaryAgentById.get(temporaryId)?.name)
    .filter((name): name is string => Boolean(name));

  return {
    selectedSavedNames,
    selectedLegacyNames,
    selectedTemporaryNames,
    selectedAgentNames: [...selectedSavedNames, ...selectedLegacyNames, ...selectedTemporaryNames]
  };
}

export function resolveDiscussionSelectionByAgentNames(
  projectAgents: PersistedDiscussionAgent[],
  temporaryDiscussionAgents: TemporaryDiscussionAgent[],
  agentNames: string[]
): DiscussionSelectionByName {
  const remainingSavedIdsByName = new Map<string, string[]>();
  const remainingLegacyNames = new Set(
    projectAgents
      .filter((agent) => !agent.id)
      .map((agent) => agent.name)
  );
  const remainingTemporaryIdsByName = new Map<string, string[]>();

  for (const agent of projectAgents) {
    if (!agent.id) continue;
    const queue = remainingSavedIdsByName.get(agent.name) || [];
    queue.push(agent.id);
    remainingSavedIdsByName.set(agent.name, queue);
  }

  for (const agent of temporaryDiscussionAgents) {
    const queue = remainingTemporaryIdsByName.get(agent.name) || [];
    queue.push(agent.id);
    remainingTemporaryIdsByName.set(agent.name, queue);
  }

  const selectedDiscussionMemberIds: string[] = [];
  const selectedLegacyDiscussionAgentNames: string[] = [];
  const selectedTemporaryDiscussionAgentIds: string[] = [];
  const unresolvedAgentNames: string[] = [];

  for (const agentName of agentNames) {
    const savedIds = remainingSavedIdsByName.get(agentName);
    if (savedIds && savedIds.length > 0) {
      const memberId = savedIds.shift();
      if (memberId) {
        selectedDiscussionMemberIds.push(memberId);
        continue;
      }
    }

    if (remainingLegacyNames.has(agentName)) {
      selectedLegacyDiscussionAgentNames.push(agentName);
      remainingLegacyNames.delete(agentName);
      continue;
    }

    const temporaryIds = remainingTemporaryIdsByName.get(agentName);
    if (temporaryIds && temporaryIds.length > 0) {
      const temporaryId = temporaryIds.shift();
      if (temporaryId) {
        selectedTemporaryDiscussionAgentIds.push(temporaryId);
        continue;
      }
    }

    unresolvedAgentNames.push(agentName);
  }

  return {
    selectedDiscussionMemberIds: dedupeDiscussionSelectionValues(selectedDiscussionMemberIds),
    selectedLegacyDiscussionAgentNames: dedupeDiscussionSelectionValues(selectedLegacyDiscussionAgentNames),
    selectedTemporaryDiscussionAgentIds: dedupeDiscussionSelectionValues(selectedTemporaryDiscussionAgentIds),
    unresolvedAgentNames
  };
}
