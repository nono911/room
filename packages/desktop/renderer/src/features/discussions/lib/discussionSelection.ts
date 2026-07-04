export type PersistedDiscussionAgent = {
  id?: string;
  name: string;
  role?: string;
  isVirtual?: boolean;
};

export type DiscussionParticipantKind = 'member' | 'legacy' | 'tmp';
export type DiscussionParticipantKey = `member:${string}` | `legacy:${string}` | `tmp:${string}`;

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
  selectedDiscussionParticipantKeys?: DiscussionParticipantKey[];
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
  selectedDiscussionParticipantKeys: DiscussionParticipantKey[];
  selectedDiscussionMemberIds: string[];
  selectedLegacyDiscussionAgentNames: string[];
  selectedTemporaryDiscussionAgentIds: string[];
  unresolvedAgentNames: string[];
}

export interface DiscussionSelectionValuesByKind {
  selectedDiscussionMemberIds: string[];
  selectedLegacyDiscussionAgentNames: string[];
  selectedTemporaryDiscussionAgentIds: string[];
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

export function createDiscussionParticipantKey(
  kind: DiscussionParticipantKind,
  value: string
): DiscussionParticipantKey {
  return `${kind}:${value}` as DiscussionParticipantKey;
}

export function parseDiscussionParticipantKey(
  key: string
): { kind: DiscussionParticipantKind; value: string } | null {
  const [kind, ...rest] = key.split(':');
  const value = rest.join(':').trim();
  if (!value) {
    return null;
  }
  if (kind === 'member' || kind === 'legacy' || kind === 'tmp') {
    return { kind, value };
  }
  return null;
}

export function dedupeDiscussionParticipantKeys(
  keys: DiscussionParticipantKey[]
): DiscussionParticipantKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function appendUniqueDiscussionParticipantKeys(
  prev: DiscussionParticipantKey[],
  next: DiscussionParticipantKey[]
): DiscussionParticipantKey[] {
  return dedupeDiscussionParticipantKeys([...prev, ...next]);
}

export function removeDiscussionParticipantKey(
  prev: DiscussionParticipantKey[],
  key: DiscussionParticipantKey
): DiscussionParticipantKey[] {
  return prev.filter((entry) => entry !== key);
}

export function reorderDiscussionParticipantKeys(
  prev: DiscussionParticipantKey[],
  sourceIndex: number,
  targetIndex: number
): DiscussionParticipantKey[] {
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
  return dedupeDiscussionParticipantKeys(next);
}

export function getDiscussionSelectionValuesByKind(
  participantKeys: DiscussionParticipantKey[]
): DiscussionSelectionValuesByKind {
  const selectedDiscussionMemberIds: string[] = [];
  const selectedLegacyDiscussionAgentNames: string[] = [];
  const selectedTemporaryDiscussionAgentIds: string[] = [];

  for (const key of participantKeys) {
    const parsed = parseDiscussionParticipantKey(key);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === 'member') {
      selectedDiscussionMemberIds.push(parsed.value);
    } else if (parsed.kind === 'legacy') {
      selectedLegacyDiscussionAgentNames.push(parsed.value);
    } else {
      selectedTemporaryDiscussionAgentIds.push(parsed.value);
    }
  }

  return {
    selectedDiscussionMemberIds: dedupeDiscussionSelectionValues(selectedDiscussionMemberIds),
    selectedLegacyDiscussionAgentNames: dedupeDiscussionSelectionValues(selectedLegacyDiscussionAgentNames),
    selectedTemporaryDiscussionAgentIds: dedupeDiscussionSelectionValues(selectedTemporaryDiscussionAgentIds)
  };
}

export function replaceDiscussionParticipantKeysOfKind(
  participantKeys: DiscussionParticipantKey[],
  kind: DiscussionParticipantKind,
  values: string[]
): DiscussionParticipantKey[] {
  const nextKeys = dedupeDiscussionParticipantKeys(
    values.map((value) => createDiscussionParticipantKey(kind, value))
  );
  const nextParticipantKeys: DiscussionParticipantKey[] = [];
  let inserted = false;

  for (const key of participantKeys) {
    const parsed = parseDiscussionParticipantKey(key);
    if (parsed?.kind !== kind) {
      nextParticipantKeys.push(key);
      continue;
    }

    if (!inserted) {
      nextParticipantKeys.push(...nextKeys);
      inserted = true;
    }
  }

  if (!inserted) {
    nextParticipantKeys.push(...nextKeys);
  }

  return dedupeDiscussionParticipantKeys(nextParticipantKeys);
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
  selectedDiscussionParticipantKeys,
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
  const orderedParticipantKeys = (
    selectedDiscussionParticipantKeys && selectedDiscussionParticipantKeys.length > 0
      ? selectedDiscussionParticipantKeys
      : [
          ...selectedDiscussionMemberIds.map((memberId) => createDiscussionParticipantKey('member', memberId)),
          ...selectedLegacyDiscussionAgentNames.map((agentName) => createDiscussionParticipantKey('legacy', agentName)),
          ...selectedTemporaryDiscussionAgentIds.map((temporaryId) => createDiscussionParticipantKey('tmp', temporaryId))
        ]
  );
  const selectedSavedNames: string[] = [];
  const selectedLegacyNames: string[] = [];
  const selectedTemporaryNames: string[] = [];
  const selectedAgentNames: string[] = [];

  for (const key of dedupeDiscussionParticipantKeys(orderedParticipantKeys)) {
    const parsed = parseDiscussionParticipantKey(key);
    if (!parsed) {
      continue;
    }

    if (parsed.kind === 'member') {
      const name = memberById.get(parsed.value)?.name;
      if (!name) {
        continue;
      }
      selectedSavedNames.push(name);
      selectedAgentNames.push(name);
      continue;
    }

    if (parsed.kind === 'legacy') {
      if (!availablePersistedNames.has(parsed.value)) {
        continue;
      }
      selectedLegacyNames.push(parsed.value);
      selectedAgentNames.push(parsed.value);
      continue;
    }

    const temporaryName = temporaryAgentById.get(parsed.value)?.name;
    if (!temporaryName) {
      continue;
    }
    selectedTemporaryNames.push(temporaryName);
    selectedAgentNames.push(temporaryName);
  }

  return {
    selectedSavedNames,
    selectedLegacyNames,
    selectedTemporaryNames,
    selectedAgentNames
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
  const selectedDiscussionParticipantKeys: DiscussionParticipantKey[] = [];
  const unresolvedAgentNames: string[] = [];

  for (const agentName of agentNames) {
    const savedIds = remainingSavedIdsByName.get(agentName);
    if (savedIds && savedIds.length > 0) {
      const memberId = savedIds.shift();
      if (memberId) {
        selectedDiscussionMemberIds.push(memberId);
        selectedDiscussionParticipantKeys.push(createDiscussionParticipantKey('member', memberId));
        continue;
      }
    }

    if (remainingLegacyNames.has(agentName)) {
      selectedLegacyDiscussionAgentNames.push(agentName);
      selectedDiscussionParticipantKeys.push(createDiscussionParticipantKey('legacy', agentName));
      remainingLegacyNames.delete(agentName);
      continue;
    }

    const temporaryIds = remainingTemporaryIdsByName.get(agentName);
    if (temporaryIds && temporaryIds.length > 0) {
      const temporaryId = temporaryIds.shift();
      if (temporaryId) {
        selectedTemporaryDiscussionAgentIds.push(temporaryId);
        selectedDiscussionParticipantKeys.push(createDiscussionParticipantKey('tmp', temporaryId));
        continue;
      }
    }

    unresolvedAgentNames.push(agentName);
  }

  return {
    selectedDiscussionParticipantKeys: dedupeDiscussionParticipantKeys(selectedDiscussionParticipantKeys),
    selectedDiscussionMemberIds: dedupeDiscussionSelectionValues(selectedDiscussionMemberIds),
    selectedLegacyDiscussionAgentNames: dedupeDiscussionSelectionValues(selectedLegacyDiscussionAgentNames),
    selectedTemporaryDiscussionAgentIds: dedupeDiscussionSelectionValues(selectedTemporaryDiscussionAgentIds),
    unresolvedAgentNames
  };
}
