import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectData } from '../../types/domain.js';
import {
  appendUniqueDiscussionParticipantKeys,
  areDiscussionSelectionValuesEqual,
  dedupeDiscussionSelectionValues,
  getDiscussionSelectionValuesByKind,
  getPersistedDiscussionAgents,
  parseDiscussionParticipantKey,
  removeDiscussionParticipantKey,
  reorderDiscussionParticipantKeys,
  reorderDiscussionSelectionValues,
  replaceDiscussionParticipantKeysOfKind,
  resolveDiscussionSelection,
  resolveDiscussionSelectionByAgentNames,
  createDiscussionParticipantKey,
  type DiscussionParticipantKey,
  type PersistedDiscussionAgent,
  type TemporaryDiscussionAgent
} from './lib/discussionSelection.js';

interface UseDiscussionSelectionOptions {
  projectData: ProjectData | null;
}

export function useDiscussionSelection({ projectData }: UseDiscussionSelectionOptions) {
  const [selectedDiscussionParticipantKeysState, setSelectedDiscussionParticipantKeysState] = useState<DiscussionParticipantKey[]>([]);
  const [temporaryDiscussionAgents, setTemporaryDiscussionAgentsState] = useState<TemporaryDiscussionAgent[]>([]);
  const [pendingDiscussionAgentNames, setPendingDiscussionAgentNames] = useState<string[]>([]);
  const persistedDiscussionAgents = useMemo(
    () => getPersistedDiscussionAgents((projectData?.agents || []) as PersistedDiscussionAgent[]),
    [projectData]
  );
  const {
    selectedDiscussionMemberIds,
    selectedLegacyDiscussionAgentNames,
    selectedTemporaryDiscussionAgentIds
  } = useMemo(
    () => getDiscussionSelectionValuesByKind(selectedDiscussionParticipantKeysState),
    [selectedDiscussionParticipantKeysState]
  );

  const {
    selectedSavedNames,
    selectedLegacyNames,
    selectedTemporaryNames,
    selectedAgentNames: selectedDiscussionAgents
  } = useMemo(() => resolveDiscussionSelection({
    projectAgents: persistedDiscussionAgents,
    selectedDiscussionParticipantKeys: selectedDiscussionParticipantKeysState,
    selectedDiscussionMemberIds,
    selectedLegacyDiscussionAgentNames,
    temporaryDiscussionAgents,
    selectedTemporaryDiscussionAgentIds
  }), [
    persistedDiscussionAgents,
    selectedDiscussionParticipantKeysState,
    selectedDiscussionMemberIds,
    selectedLegacyDiscussionAgentNames,
    temporaryDiscussionAgents,
    selectedTemporaryDiscussionAgentIds
  ]);

  const applySelectionByNames = useCallback((agentNames: string[]) => {
    const resolved = resolveDiscussionSelectionByAgentNames(
      persistedDiscussionAgents,
      temporaryDiscussionAgents,
      agentNames
    );
    setSelectedDiscussionParticipantKeysState(resolved.selectedDiscussionParticipantKeys);
    setPendingDiscussionAgentNames(resolved.unresolvedAgentNames);
  }, [persistedDiscussionAgents, temporaryDiscussionAgents]);

  useEffect(() => {
    const savedAgentIds = new Set(
      persistedDiscussionAgents
        .filter((agent): agent is PersistedDiscussionAgent & { id: string } => typeof agent.id === 'string' && agent.id.length > 0)
        .map((agent) => agent.id)
    );
    const persistedNames = new Set(persistedDiscussionAgents.map((agent) => agent.name));
    const temporaryIds = new Set(temporaryDiscussionAgents.map((agent) => agent.id));

    setSelectedDiscussionParticipantKeysState((prev) => {
      const next = prev.filter((key) => {
        const parsed = parseDiscussionParticipantKey(key);
        if (!parsed) {
          return false;
        }
        if (parsed.kind === 'member') {
          return savedAgentIds.has(parsed.value);
        }
        if (parsed.kind === 'legacy') {
          return persistedNames.has(parsed.value);
        }
        return temporaryIds.has(parsed.value);
      });
      return areDiscussionSelectionValuesEqual(prev, next) ? prev : next;
    });
  }, [persistedDiscussionAgents, temporaryDiscussionAgents]);

  useEffect(() => {
    if (pendingDiscussionAgentNames.length === 0) return;
    const resolved = resolveDiscussionSelectionByAgentNames(
      persistedDiscussionAgents,
      temporaryDiscussionAgents,
      pendingDiscussionAgentNames
    );
    if (resolved.unresolvedAgentNames.length === pendingDiscussionAgentNames.length) {
      return;
    }
    setSelectedDiscussionParticipantKeysState((prev) => (
      appendUniqueDiscussionParticipantKeys(prev, resolved.selectedDiscussionParticipantKeys)
    ));
    setPendingDiscussionAgentNames(resolved.unresolvedAgentNames);
  }, [pendingDiscussionAgentNames, persistedDiscussionAgents, temporaryDiscussionAgents]);

  const setSelectedDiscussionMemberIds = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState((prev) => replaceDiscussionParticipantKeysOfKind(
      prev,
      'member',
      dedupeDiscussionSelectionValues(
        typeof value === 'function' ? value(getDiscussionSelectionValuesByKind(prev).selectedDiscussionMemberIds) : value
      )
    ));
  }, []);

  const setSelectedLegacyDiscussionAgentNames = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState((prev) => replaceDiscussionParticipantKeysOfKind(
      prev,
      'legacy',
      dedupeDiscussionSelectionValues(
        typeof value === 'function'
          ? value(getDiscussionSelectionValuesByKind(prev).selectedLegacyDiscussionAgentNames)
          : value
      )
    ));
  }, []);

  const setSelectedTemporaryDiscussionAgentIds = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState((prev) => replaceDiscussionParticipantKeysOfKind(
      prev,
      'tmp',
      dedupeDiscussionSelectionValues(
        typeof value === 'function'
          ? value(getDiscussionSelectionValuesByKind(prev).selectedTemporaryDiscussionAgentIds)
          : value
      )
    ));
  }, []);

  const setTemporaryDiscussionAgents = useCallback((value: TemporaryDiscussionAgent[] | ((prev: TemporaryDiscussionAgent[]) => TemporaryDiscussionAgent[])) => {
    setTemporaryDiscussionAgentsState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      const seen = new Set<string>();
      return next.filter((agent) => {
        if (!agent.id || seen.has(agent.id)) {
          return false;
        }
        seen.add(agent.id);
        return true;
      });
    });
  }, []);

  const setSelectedDiscussionAgents = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    const previous = [...selectedSavedNames, ...selectedLegacyNames, ...selectedTemporaryNames];
    const nextNames = typeof value === 'function' ? value(previous) : value;
    applySelectionByNames(nextNames);
  }, [applySelectionByNames, selectedLegacyNames, selectedSavedNames, selectedTemporaryNames]);

  const queueDiscussionAgentSelectionByNames = useCallback((agentNames: string[]) => {
    applySelectionByNames(agentNames);
  }, [applySelectionByNames]);

  const appendSelectedDiscussionMemberIds = useCallback((memberIds: string[]) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState((prev) => appendUniqueDiscussionParticipantKeys(
      prev,
      dedupeDiscussionSelectionValues(memberIds).map((memberId) => createDiscussionParticipantKey('member', memberId))
    ));
  }, []);

  const appendSelectedTemporaryDiscussionAgentIds = useCallback((temporaryIds: string[]) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState((prev) => appendUniqueDiscussionParticipantKeys(
      prev,
      dedupeDiscussionSelectionValues(temporaryIds).map((temporaryId) => createDiscussionParticipantKey('tmp', temporaryId))
    ));
  }, []);

  const toggleSelectedDiscussionMemberId = useCallback((memberId: string) => {
    setPendingDiscussionAgentNames([]);
    const participantKey = createDiscussionParticipantKey('member', memberId);
    setSelectedDiscussionParticipantKeysState((prev) => (
      prev.includes(participantKey)
        ? removeDiscussionParticipantKey(prev, participantKey)
        : appendUniqueDiscussionParticipantKeys(prev, [participantKey])
    ));
  }, []);

  const toggleSelectedLegacyDiscussionAgentName = useCallback((agentName: string) => {
    setPendingDiscussionAgentNames([]);
    const participantKey = createDiscussionParticipantKey('legacy', agentName);
    setSelectedDiscussionParticipantKeysState((prev) => (
      prev.includes(participantKey)
        ? removeDiscussionParticipantKey(prev, participantKey)
        : appendUniqueDiscussionParticipantKeys(prev, [participantKey])
    ));
  }, []);

  const toggleSelectedTemporaryDiscussionAgentId = useCallback((temporaryId: string) => {
    setPendingDiscussionAgentNames([]);
    const participantKey = createDiscussionParticipantKey('tmp', temporaryId);
    setSelectedDiscussionParticipantKeysState((prev) => (
      prev.includes(participantKey)
        ? removeDiscussionParticipantKey(prev, participantKey)
        : appendUniqueDiscussionParticipantKeys(prev, [participantKey])
    ));
  }, []);

  const reorderSelectedDiscussionMemberIds = useCallback((sourceIndex: number, targetIndex: number) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState((prev) => {
      const current = getDiscussionSelectionValuesByKind(prev).selectedDiscussionMemberIds;
      return replaceDiscussionParticipantKeysOfKind(
        prev,
        'member',
        reorderDiscussionSelectionValues(current, sourceIndex, targetIndex)
      );
    });
  }, []);

  const reorderSelectedDiscussionParticipants = useCallback((sourceIndex: number, targetIndex: number) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState((prev) => reorderDiscussionParticipantKeys(prev, sourceIndex, targetIndex));
  }, []);

  const clearSelectedDiscussionAgents = useCallback(() => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionParticipantKeysState([]);
  }, []);

  const selectDefaultDiscussionAgents = useCallback((agents: PersistedDiscussionAgent[]) => {
    const registeredAgents = (agents || []).filter((agent) => !agent.isVirtual);
    const savedAgents = registeredAgents.filter(
      (agent): agent is PersistedDiscussionAgent & { id: string } =>
        typeof agent.id === 'string' && agent.id.length > 0
    );

    if (pendingDiscussionAgentNames.length > 0) {
      return;
    }

    if (savedAgents.length > 0) {
      const validIds = new Set(savedAgents.map((agent) => agent.id));
      setSelectedDiscussionParticipantKeysState((prev) => {
        const nextMemberIds = dedupeDiscussionSelectionValues(
          getDiscussionSelectionValuesByKind(prev).selectedDiscussionMemberIds.filter((memberId) => validIds.has(memberId))
        );
        const memberIds = nextMemberIds.length > 0
          ? nextMemberIds
          : savedAgents.slice(0, 2).map((agent) => agent.id);
        return replaceDiscussionParticipantKeysOfKind(
          replaceDiscussionParticipantKeysOfKind(prev, 'legacy', []),
          'member',
          memberIds
        );
      });
      return;
    }

    if (registeredAgents.length > 0) {
      const names = registeredAgents.map((agent) => agent.name);
      setSelectedDiscussionParticipantKeysState((prev) => {
        const nextLegacyNames = dedupeDiscussionSelectionValues(
          getDiscussionSelectionValuesByKind(prev).selectedLegacyDiscussionAgentNames.filter((name) => names.includes(name))
        );
        const legacyNames = nextLegacyNames.length > 0
          ? nextLegacyNames
          : names.slice(0, 2);
        return replaceDiscussionParticipantKeysOfKind(
          replaceDiscussionParticipantKeysOfKind(prev, 'member', []),
          'legacy',
          legacyNames
        );
      });
      return;
    }

    clearSelectedDiscussionAgents();
  }, [clearSelectedDiscussionAgents, pendingDiscussionAgentNames.length]);

  return {
    selectedDiscussionAgents,
    selectedDiscussionParticipantKeys: selectedDiscussionParticipantKeysState,
    selectedDiscussionMemberIds,
    selectedLegacyDiscussionAgentNames,
    selectedTemporaryDiscussionAgentIds,
    temporaryDiscussionAgents,
    setSelectedDiscussionAgents,
    queueDiscussionAgentSelectionByNames,
    setSelectedDiscussionMemberIds,
    setSelectedLegacyDiscussionAgentNames,
    setSelectedTemporaryDiscussionAgentIds,
    setTemporaryDiscussionAgents,
    appendSelectedDiscussionMemberIds,
    appendSelectedTemporaryDiscussionAgentIds,
    toggleSelectedDiscussionMemberId,
    toggleSelectedLegacyDiscussionAgentName,
    toggleSelectedTemporaryDiscussionAgentId,
    reorderSelectedDiscussionMemberIds,
    reorderSelectedDiscussionParticipants,
    clearSelectedDiscussionAgents,
    selectDefaultDiscussionAgents
  };
}
