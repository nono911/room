import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ContextPickerItem } from '../../types/domain.js';
import { api } from '../ipc/client.js';

type ContextPickerTarget = 'discussion' | 'task';
type ContextPickerTab = 'Suggested' | 'Tasks' | 'Docs' | 'Files';

interface UseContextPickerDeps {
  projectPath: string | null;
  activeSourceId?: string;
  selectedDiscussionContextRefs: string[];
  setSelectedDiscussionContextRefs: Dispatch<SetStateAction<string[]>>;
  selectedCodingTaskContextRefs: string[];
  setSelectedCodingTaskContextRefs: Dispatch<SetStateAction<string[]>>;
  setErrorMsg: (value: string | null) => void;
}

export function filterContextRefsForSource(
  refs: string[],
  activeSourceId?: string
): string[] {
  const sourcePrefix = activeSourceId ? `source-file:${activeSourceId}:` : '';
  return refs.filter(ref => !ref.startsWith('source-file:') || (
    Boolean(sourcePrefix) && ref.startsWith(sourcePrefix)
  ));
}

export function useContextPicker({
  projectPath,
  activeSourceId,
  selectedDiscussionContextRefs,
  setSelectedDiscussionContextRefs,
  selectedCodingTaskContextRefs,
  setSelectedCodingTaskContextRefs,
  setErrorMsg
}: UseContextPickerDeps) {
  const [contextPickerTarget, setContextPickerTarget] = useState<ContextPickerTarget | null>(null);
  const [contextPickerQuery, setContextPickerQuery] = useState<string>('');
  const [contextPickerTab, setContextPickerTab] = useState<ContextPickerTab>('Suggested');
  const [contextPickerItems, setContextPickerItems] = useState<ContextPickerItem[]>([]);
  const [contextPickerLoading, setContextPickerLoading] = useState<boolean>(false);

  useEffect(() => {
    setSelectedDiscussionContextRefs(refs => filterContextRefsForSource(refs, activeSourceId));
    setSelectedCodingTaskContextRefs(refs => filterContextRefsForSource(refs, activeSourceId));
  }, [
    activeSourceId,
    setSelectedCodingTaskContextRefs,
    setSelectedDiscussionContextRefs
  ]);

  useEffect(() => {
    if (!projectPath || !contextPickerTarget) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setContextPickerLoading(true);
      try {
        const res = await api.searchContextItems(projectPath, activeSourceId, contextPickerQuery);
        if (cancelled) return;
        if (res.success) {
          setContextPickerItems(res.items || []);
        } else {
          setContextPickerItems([]);
          setErrorMsg(res.error || 'Failed to search context.');
        }
      } catch (err: any) {
        if (!cancelled) {
          setContextPickerItems([]);
          setErrorMsg(err.message || 'Failed to search context.');
        }
      } finally {
        if (!cancelled) {
          setContextPickerLoading(false);
        }
      }
    }, contextPickerQuery.trim() ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSourceId, projectPath, contextPickerTarget, contextPickerQuery, setErrorMsg]);

  const openContextPicker = (target: ContextPickerTarget) => {
    setContextPickerTarget(target);
    setContextPickerQuery('');
    setContextPickerTab('Suggested');
  };

  const closeContextPicker = () => {
    setContextPickerTarget(null);
  };

  const resetContextPicker = () => {
    setContextPickerTarget(null);
    setContextPickerItems([]);
  };

  const getContextSelection = (target: ContextPickerTarget) => (
    target === 'discussion' ? selectedDiscussionContextRefs : selectedCodingTaskContextRefs
  );

  const setContextSelection = (target: ContextPickerTarget, refs: string[]) => {
    const filteredRefs = filterContextRefsForSource(refs, activeSourceId);
    if (target === 'discussion') {
      setSelectedDiscussionContextRefs(filteredRefs);
    } else {
      setSelectedCodingTaskContextRefs(filteredRefs);
    }
  };

  const toggleContextSelection = (target: ContextPickerTarget, ref: string) => {
    const selectedRefs = getContextSelection(target);
    setContextSelection(
      target,
      selectedRefs.includes(ref)
        ? selectedRefs.filter(item => item !== ref)
        : [...selectedRefs, ref]
    );
  };

  const getContextLabel = (ref: string) => {
    if (ref === 'workspace:overview') return 'Room Overview';
    if (ref === 'workspace:structure') return 'Room Structure';
    const known = contextPickerItems.find(item => item.ref === ref);
    if (known) return known.label;
    if (ref.startsWith('task:')) return `Task: ${ref.slice('task:'.length)}`;
    if (ref.startsWith('document:')) return `Doc: ${ref.slice('document:'.length)}`;
    if (ref.startsWith('discussion:')) return `Chat: ${ref.slice('discussion:'.length)}`;
    if (ref.startsWith('source-file:')) {
      const encodedPath = ref.split(':').slice(2).join(':');
      try {
        return `Source File: ${decodeURIComponent(encodedPath)}`;
      } catch {
        return 'Source File';
      }
    }
    return ref;
  };

  const getFilteredContextItems = () => {
    if (contextPickerTab === 'Tasks') {
      return contextPickerItems.filter(item => item.type === 'task' || /task|todo|plan|issue|bug|ticket|backlog/i.test(`${item.label} ${item.path || ''}`));
    }
    if (contextPickerTab === 'Docs') {
      return contextPickerItems.filter(item => item.type === 'doc' || item.type === 'workspace');
    }
    if (contextPickerTab === 'Files') {
      return contextPickerItems.filter(item => item.type === 'file');
    }
    return contextPickerItems;
  };

  const estimateContextTokens = (target: ContextPickerTarget) => {
    const selectedRefs = getContextSelection(target);
    const bytes = selectedRefs.reduce((total, ref) => {
      const item = contextPickerItems.find(candidate => candidate.ref === ref);
      return total + (item?.size || 12000);
    }, 0);
    return Math.max(selectedRefs.length * 80, Math.round(bytes / 4));
  };

  return {
    contextPickerTarget,
    contextPickerQuery, setContextPickerQuery,
    contextPickerTab, setContextPickerTab,
    contextPickerLoading,
    openContextPicker,
    closeContextPicker,
    resetContextPicker,
    getContextSelection,
    setContextSelection,
    toggleContextSelection,
    getContextLabel,
    getFilteredContextItems,
    estimateContextTokens
  };
}
