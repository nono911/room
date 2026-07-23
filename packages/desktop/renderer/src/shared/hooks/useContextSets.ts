import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [contextSetsMutating, setContextSetsMutating] = useState(false);
  const activeProjectPathRef = useRef(projectPath);
  const contextSetsRef = useRef<ContextSet[]>([]);
  const loadingRef = useRef(false);
  const loadRequestRef = useRef(0);
  const mutationCountsRef = useRef(new Map<string, number>());
  const mutationQueuesRef = useRef(new Map<string, Promise<void>>());
  activeProjectPathRef.current = projectPath;

  useEffect(() => {
    const activeCount = projectPath
      ? mutationCountsRef.current.get(projectPath) || 0
      : 0;
    setContextSetsMutating(activeCount > 0);
  }, [projectPath]);

  const replaceContextSets = useCallback((nextSets: ContextSet[]) => {
    contextSetsRef.current = nextSets;
    setContextSets(nextSets);
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    loadingRef.current = loading;
    setContextSetsLoading(loading);
  }, []);

  const loadContextSets = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const requestPath = projectPath;
    replaceContextSets([]);
    if (!projectPath) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await api.loadContextSets(projectPath);
      if (
        requestId !== loadRequestRef.current
        || activeProjectPathRef.current !== requestPath
      ) return;
      if (!result.success) {
        setErrorMsg(result.error || 'Failed to load saved context sets.');
        return;
      }
      replaceContextSets(result.contextSets || []);
    } catch (error) {
      if (
        requestId !== loadRequestRef.current
        || activeProjectPathRef.current !== requestPath
      ) return;
      setErrorMsg(error instanceof Error ? error.message : 'Failed to load saved context sets.');
    } finally {
      if (
        requestId === loadRequestRef.current
        && activeProjectPathRef.current === requestPath
      ) {
        setLoading(false);
      }
    }
  }, [projectPath, replaceContextSets, setErrorMsg, setLoading]);

  useEffect(() => {
    void loadContextSets();
  }, [loadContextSets]);

  const persist = useCallback((
    createNextSets: (currentSets: ContextSet[]) => ContextSet[]
  ): Promise<boolean> => {
    if (!projectPath || loadingRef.current) return Promise.resolve(false);
    const requestPath = projectPath;
    const currentCount = mutationCountsRef.current.get(requestPath) || 0;
    mutationCountsRef.current.set(requestPath, currentCount + 1);
    if (activeProjectPathRef.current === requestPath) {
      setContextSetsMutating(true);
    }

    const execute = async (): Promise<boolean> => {
      if (
        activeProjectPathRef.current !== requestPath
        || loadingRef.current
      ) return false;

      ++loadRequestRef.current;
      const nextSets = createNextSets(contextSetsRef.current);
      try {
        const result = await api.saveContextSets(requestPath, nextSets);
        if (activeProjectPathRef.current !== requestPath) return false;
        if (!result.success) {
          setErrorMsg(result.error || 'Failed to save context sets.');
          return false;
        }
        ++loadRequestRef.current;
        setLoading(false);
        replaceContextSets(nextSets);
        return true;
      } catch (error) {
        if (activeProjectPathRef.current === requestPath) {
          setErrorMsg(error instanceof Error ? error.message : 'Failed to save context sets.');
        }
        return false;
      }
    };

    const priorMutation = mutationQueuesRef.current.get(requestPath) || Promise.resolve();
    const pending = priorMutation.then(execute, execute);
    const settled = pending.then(() => undefined, () => undefined);
    mutationQueuesRef.current.set(requestPath, settled);
    return pending.finally(() => {
      const remaining = Math.max(
        0,
        (mutationCountsRef.current.get(requestPath) || 0) - 1
      );
      if (remaining === 0) {
        mutationCountsRef.current.delete(requestPath);
        if (mutationQueuesRef.current.get(requestPath) === settled) {
          mutationQueuesRef.current.delete(requestPath);
        }
      } else {
        mutationCountsRef.current.set(requestPath, remaining);
      }
      if (activeProjectPathRef.current === requestPath) {
        setContextSetsMutating(remaining > 0);
      }
    });
  }, [projectPath, replaceContextSets, setErrorMsg, setLoading]);

  const saveContextSet = useCallback(async (name: string, refs: string[]): Promise<boolean> => {
    const normalizedName = name.trim();
    if (!normalizedName || refs.length === 0) return false;
    const now = new Date().toISOString();
    return persist((currentSets) => {
      const existing = currentSets.find(
        set => set.name.toLowerCase() === normalizedName.toLowerCase()
      );
      const nextSet: ContextSet = existing
        ? { ...existing, name: normalizedName, refs: Array.from(new Set(refs)), updatedAt: now }
        : {
            id: createContextSetId(),
            name: normalizedName,
            refs: Array.from(new Set(refs)),
            createdAt: now,
            updatedAt: now
          };
      return existing
        ? currentSets.map(set => set.id === existing.id ? nextSet : set)
        : [...currentSets, nextSet];
    });
  }, [persist]);

  const deleteContextSet = useCallback(async (id: string): Promise<boolean> => {
    return persist(currentSets => currentSets.filter(set => set.id !== id));
  }, [persist]);

  return {
    contextSets,
    contextSetsLoading,
    contextSetsMutating,
    loadContextSets,
    saveContextSet,
    deleteContextSet
  };
}
