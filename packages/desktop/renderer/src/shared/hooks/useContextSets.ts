import { useCallback, useEffect, useState } from 'react';
import type { ContextSet } from '../../types/domain.js';
import { api } from '../ipc/client.js';

interface UseContextSetsOptions {
  projectPath: string | null;
  setErrorMsg: (value: string | null) => void;
}

function createContextSetId(): string {
  const randomPart = Math.random().toString(36).slice(2, 9);
  return `ctx-${Date.now().toString(36)}-${randomPart}`;
}

export function useContextSets({ projectPath, setErrorMsg }: UseContextSetsOptions) {
  const [contextSets, setContextSets] = useState<ContextSet[]>([]);
  const [contextSetsLoading, setContextSetsLoading] = useState(false);

  const loadContextSets = useCallback(async () => {
    if (!projectPath) {
      setContextSets([]);
      return;
    }
    setContextSetsLoading(true);
    try {
      const result = await api.loadContextSets(projectPath);
      if (!result.success) {
        setErrorMsg(result.error || 'Failed to load saved context sets.');
        return;
      }
      setContextSets(result.contextSets || []);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to load saved context sets.');
    } finally {
      setContextSetsLoading(false);
    }
  }, [projectPath, setErrorMsg]);

  useEffect(() => {
    void loadContextSets();
  }, [loadContextSets]);

  const persist = useCallback(async (nextSets: ContextSet[]): Promise<boolean> => {
    if (!projectPath) return false;
    const result = await api.saveContextSets(projectPath, nextSets);
    if (!result.success) {
      setErrorMsg(result.error || 'Failed to save context sets.');
      return false;
    }
    setContextSets(nextSets);
    return true;
  }, [projectPath, setErrorMsg]);

  const saveContextSet = useCallback(async (name: string, refs: string[]): Promise<boolean> => {
    const normalizedName = name.trim();
    if (!normalizedName || refs.length === 0) return false;
    const now = new Date().toISOString();
    const existing = contextSets.find(set => set.name.toLowerCase() === normalizedName.toLowerCase());
    const nextSet: ContextSet = existing
      ? { ...existing, name: normalizedName, refs: Array.from(new Set(refs)), updatedAt: now }
      : {
          id: createContextSetId(),
          name: normalizedName,
          refs: Array.from(new Set(refs)),
          createdAt: now,
          updatedAt: now
        };
    return persist(existing
      ? contextSets.map(set => set.id === existing.id ? nextSet : set)
      : [...contextSets, nextSet]);
  }, [contextSets, persist]);

  const deleteContextSet = useCallback(async (id: string): Promise<boolean> => {
    return persist(contextSets.filter(set => set.id !== id));
  }, [contextSets, persist]);

  return {
    contextSets,
    contextSetsLoading,
    loadContextSets,
    saveContextSet,
    deleteContextSet
  };
}
