import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectData } from '../../types/domain.js';
import {
  appendUniqueDiscussionSelectionValues,
  areDiscussionSelectionValuesEqual,
  dedupeDiscussionSelectionValues,
  getPersistedDiscussionAgents,
  removeDiscussionSelectionValue,
  reorderDiscussionSelectionValues,
  resolveDiscussionSelection,
  resolveDiscussionSelectionByAgentNames,
  type PersistedDiscussionAgent,
  type TemporaryDiscussionAgent
} from './lib/discussionSelection.js';

interface UseDiscussionSelectionOptions {
  projectData: ProjectData | null;
}

export function useDiscussionSelection({ projectData }: UseDiscussionSelectionOptions) {
  const [selectedDiscussionMemberIdsState, setSelectedDiscussionMemberIdsState] = useState<string[]>([]);
  const [selectedLegacyDiscussionAgentNamesState, setSelectedLegacyDiscussionAgentNamesState] = useState<string[]>([]);
  const [selectedTemporaryDiscussionAgentIdsState, setSelectedTemporaryDiscussionAgentIdsState] = useState<string[]>([]);
  const [temporaryDiscussionAgents, setTemporaryDiscussionAgentsState] = useState<TemporaryDiscussionAgent[]>([]);
  const [pendingDiscussionAgentNames, setPendingDiscussionAgentNames] = useState<string[]>([]);
  const persistedDiscussionAgents = useMemo(
    () => getPersistedDiscussionAgents((projectData?.agents || []) as PersistedDiscussionAgent[]),
    [projectData]
  );

  const {
    selectedSavedNames,
    selectedLegacyNames,
    selectedTemporaryNames,
    selectedAgentNames: selectedDiscussionAgents
  } = useMemo(() => resolveDiscussionSelection({
    projectAgents: persistedDiscussionAgents,
    selectedDiscussionMemberIds: selectedDiscussionMemberIdsState,
    selectedLegacyDiscussionAgentNames: selectedLegacyDiscussionAgentNamesState,
    temporaryDiscussionAgents,
    selectedTemporaryDiscussionAgentIds: selectedTemporaryDiscussionAgentIdsState
  }), [
    persistedDiscussionAgents,
    selectedDiscussionMemberIdsState,
    selectedLegacyDiscussionAgentNamesState,
    temporaryDiscussionAgents,
    selectedTemporaryDiscussionAgentIdsState
  ]);

  const applySelectionByNames = useCallback((agentNames: string[]) => {
    const resolved = resolveDiscussionSelectionByAgentNames(
      persistedDiscussionAgents,
      temporaryDiscussionAgents,
      agentNames
    );
    setSelectedDiscussionMemberIdsState(resolved.selectedDiscussionMemberIds);
    setSelectedLegacyDiscussionAgentNamesState(resolved.selectedLegacyDiscussionAgentNames);
    setSelectedTemporaryDiscussionAgentIdsState(resolved.selectedTemporaryDiscussionAgentIds);
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

    setSelectedDiscussionMemberIdsState((prev) => {
      const next = dedupeDiscussionSelectionValues(prev.filter((memberId) => savedAgentIds.has(memberId)));
      return areDiscussionSelectionValuesEqual(prev, next) ? prev : next;
    });
    setSelectedLegacyDiscussionAgentNamesState((prev) => {
      const next = dedupeDiscussionSelectionValues(prev.filter((agentName) => persistedNames.has(agentName)));
      return areDiscussionSelectionValuesEqual(prev, next) ? prev : next;
    });
    setSelectedTemporaryDiscussionAgentIdsState((prev) => {
      const next = dedupeDiscussionSelectionValues(prev.filter((agentId) => temporaryIds.has(agentId)));
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
    setSelectedDiscussionMemberIdsState((prev) => appendUniqueDiscussionSelectionValues(prev, resolved.selectedDiscussionMemberIds));
    setSelectedLegacyDiscussionAgentNamesState((prev) => appendUniqueDiscussionSelectionValues(prev, resolved.selectedLegacyDiscussionAgentNames));
    setSelectedTemporaryDiscussionAgentIdsState((prev) => appendUniqueDiscussionSelectionValues(prev, resolved.selectedTemporaryDiscussionAgentIds));
    setPendingDiscussionAgentNames(resolved.unresolvedAgentNames);
  }, [pendingDiscussionAgentNames, persistedDiscussionAgents, temporaryDiscussionAgents]);

  const setSelectedDiscussionMemberIds = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionMemberIdsState((prev) => dedupeDiscussionSelectionValues(typeof value === 'function' ? value(prev) : value));
  }, []);

  const setSelectedLegacyDiscussionAgentNames = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    setPendingDiscussionAgentNames([]);
    setSelectedLegacyDiscussionAgentNamesState((prev) => dedupeDiscussionSelectionValues(typeof value === 'function' ? value(prev) : value));
  }, []);

  const setSelectedTemporaryDiscussionAgentIds = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    setPendingDiscussionAgentNames([]);
    setSelectedTemporaryDiscussionAgentIdsState((prev) => dedupeDiscussionSelectionValues(typeof value === 'function' ? value(prev) : value));
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
    setSelectedDiscussionMemberIdsState((prev) => appendUniqueDiscussionSelectionValues(prev, memberIds));
  }, []);

  const appendSelectedTemporaryDiscussionAgentIds = useCallback((temporaryIds: string[]) => {
    setPendingDiscussionAgentNames([]);
    setSelectedTemporaryDiscussionAgentIdsState((prev) => appendUniqueDiscussionSelectionValues(prev, temporaryIds));
  }, []);

  const toggleSelectedDiscussionMemberId = useCallback((memberId: string) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionMemberIdsState((prev) => (
      prev.includes(memberId)
        ? removeDiscussionSelectionValue(prev, memberId)
        : appendUniqueDiscussionSelectionValues(prev, [memberId])
    ));
  }, []);

  const toggleSelectedLegacyDiscussionAgentName = useCallback((agentName: string) => {
    setPendingDiscussionAgentNames([]);
    setSelectedLegacyDiscussionAgentNamesState((prev) => (
      prev.includes(agentName)
        ? removeDiscussionSelectionValue(prev, agentName)
        : appendUniqueDiscussionSelectionValues(prev, [agentName])
    ));
  }, []);

  const toggleSelectedTemporaryDiscussionAgentId = useCallback((temporaryId: string) => {
    setPendingDiscussionAgentNames([]);
    setSelectedTemporaryDiscussionAgentIdsState((prev) => (
      prev.includes(temporaryId)
        ? removeDiscussionSelectionValue(prev, temporaryId)
        : appendUniqueDiscussionSelectionValues(prev, [temporaryId])
    ));
  }, []);

  const reorderSelectedDiscussionMemberIds = useCallback((sourceIndex: number, targetIndex: number) => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionMemberIdsState((prev) => reorderDiscussionSelectionValues(prev, sourceIndex, targetIndex));
  }, []);

  const clearSelectedDiscussionAgents = useCallback(() => {
    setPendingDiscussionAgentNames([]);
    setSelectedDiscussionMemberIdsState([]);
    setSelectedLegacyDiscussionAgentNamesState([]);
    setSelectedTemporaryDiscussionAgentIdsState([]);
  }, []);

  const selectDefaultDiscussionAgents = useCallback((agents: PersistedDiscussionAgent[]) => {
    const registeredAgents = (agents || []).filter((agent) => !agent.isVirtual);
    const savedAgents = registeredAgents.filter(
      (agent): agent is PersistedDiscussionAgent & { id: string } =>
        typeof agent.id === 'string' && agent.id.length > 0
    );

    setPendingDiscussionAgentNames([]);
    if (savedAgents.length > 0) {
      const validIds = new Set(savedAgents.map((agent) => agent.id));
      setSelectedDiscussionMemberIdsState((prev) => {
        const next = dedupeDiscussionSelectionValues(prev.filter((memberId) => validIds.has(memberId)));
        if (next.length > 0) return next;
        return savedAgents.slice(0, 2).map((agent) => agent.id);
      });
      setSelectedLegacyDiscussionAgentNamesState([]);
      return;
    }

    if (registeredAgents.length > 0) {
      const names = registeredAgents.map((agent) => agent.name);
      setSelectedLegacyDiscussionAgentNamesState((prev) => {
        const next = dedupeDiscussionSelectionValues(prev.filter((name) => names.includes(name)));
        if (next.length > 0) return next;
        return names.slice(0, 2);
      });
      setSelectedDiscussionMemberIdsState([]);
      return;
    }

    clearSelectedDiscussionAgents();
  }, [clearSelectedDiscussionAgents]);

  return {
    selectedDiscussionAgents,
    selectedDiscussionMemberIds: selectedDiscussionMemberIdsState,
    selectedLegacyDiscussionAgentNames: selectedLegacyDiscussionAgentNamesState,
    selectedTemporaryDiscussionAgentIds: selectedTemporaryDiscussionAgentIdsState,
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
    clearSelectedDiscussionAgents,
    selectDefaultDiscussionAgents
  };
}
