import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceFileEntry } from '../../../types/domain.js';
import { api } from '../../../shared/ipc/client.js';

interface WorkspaceFileTreeProps {
  projectPath: string;
  selectedPath: string | null;
  refreshToken: number;
  onSelect: (file: WorkspaceFileEntry) => void;
  onError: (message: string) => void;
}

interface TreeBranchProps {
  directory: string;
  depth: number;
  cache: Record<string, WorkspaceFileEntry[]>;
  expanded: Set<string>;
  selectedPath: string | null;
  loadingDirectories: Set<string>;
  onToggle: (entry: WorkspaceFileEntry) => void;
  onSelect: (entry: WorkspaceFileEntry) => void;
}

function FileGlyph({ kind, expanded }: { kind: WorkspaceFileEntry['kind']; expanded: boolean }) {
  if (kind === 'directory') return <span className="file-tree-glyph">{expanded ? '▾' : '▸'}</span>;
  return <span className="file-tree-glyph file-tree-glyph-file">·</span>;
}

function TreeBranch({
  directory,
  depth,
  cache,
  expanded,
  selectedPath,
  loadingDirectories,
  onToggle,
  onSelect
}: TreeBranchProps) {
  return (
    <>
      {(cache[directory] || []).map(entry => {
        const isExpanded = expanded.has(entry.path);
        const isSelected = selectedPath === entry.path;
        return (
          <div key={entry.path}>
            <button
              type="button"
              className={`file-tree-row${isSelected ? ' is-selected' : ''}`}
              style={{ paddingLeft: `${10 + depth * 16}px` }}
              onClick={() => entry.kind === 'directory' ? onToggle(entry) : onSelect(entry)}
              title={entry.path}
            >
              <FileGlyph kind={entry.kind} expanded={isExpanded} />
              <span className={`file-tree-icon ${entry.kind}`}>{entry.kind === 'directory' ? '⌑' : '◻'}</span>
              <span className="file-tree-name">{entry.name}</span>
              {entry.kind === 'directory' && typeof entry.childCount === 'number' && (
                <span className="file-tree-count">{entry.childCount}</span>
              )}
            </button>
            {entry.kind === 'directory' && isExpanded && (
              loadingDirectories.has(entry.path) ? (
                <div className="file-tree-loading" style={{ paddingLeft: `${30 + depth * 16}px` }}>Loading…</div>
              ) : (
                <TreeBranch
                  directory={entry.path}
                  depth={depth + 1}
                  cache={cache}
                  expanded={expanded}
                  selectedPath={selectedPath}
                  loadingDirectories={loadingDirectories}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              )
            )}
          </div>
        );
      })}
    </>
  );
}

export function WorkspaceFileTree({
  projectPath,
  selectedPath,
  refreshToken,
  onSelect,
  onError
}: WorkspaceFileTreeProps) {
  const [query, setQuery] = useState('');
  const [cache, setCache] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<WorkspaceFileEntry[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const loadDirectory = useCallback(async (directory: string) => {
    setLoadingDirectories(current => new Set(current).add(directory));
    try {
      const result = await api.browseWorkspaceFiles(projectPath, directory);
      if (!result.success) {
        onError(result.error || 'Failed to browse workspace files.');
        return;
      }
      setCache(current => ({ ...current, [directory]: result.files || [] }));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to browse workspace files.');
    } finally {
      setLoadingDirectories(current => {
        const next = new Set(current);
        next.delete(directory);
        return next;
      });
    }
  }, [projectPath, onError]);

  useEffect(() => {
    setCache({});
    setExpanded(new Set());
    setSearchResults([]);
    void loadDirectory('');
  }, [projectPath, refreshToken, loadDirectory]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchResults([]);
      setTruncated(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const result = await api.browseWorkspaceFiles(projectPath, '', normalizedQuery);
      if (!cancelled) {
        if (result.success) {
          setSearchResults((result.files || []).filter(item => item.kind === 'file'));
          setTruncated(!!result.truncated);
        } else {
          onError(result.error || 'Failed to search workspace files.');
        }
        setSearching(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectPath, query, onError]);

  const toggleDirectory = useCallback((entry: WorkspaceFileEntry) => {
    const willExpand = !expanded.has(entry.path);
    setExpanded(current => {
      const next = new Set(current);
      if (willExpand) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
    if (willExpand && !cache[entry.path]) void loadDirectory(entry.path);
  }, [cache, expanded, loadDirectory]);

  const resultLabel = useMemo(() => {
    if (searching) return 'Searching source…';
    if (!query.trim()) return 'Attached source';
    return `${searchResults.length}${truncated ? '+' : ''} matching files`;
  }, [query, searchResults.length, searching, truncated]);

  return (
    <div className="file-tree">
      <div className="file-tree-search">
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search the full source…"
        />
        <span>{resultLabel}</span>
      </div>
      <div className="file-tree-scroll">
        {query.trim() ? (
          searchResults.length === 0 && !searching ? (
            <div className="file-tree-empty">No matching source files.</div>
          ) : searchResults.map(entry => (
            <button
              key={entry.path}
              type="button"
              className={`file-tree-row search-result${selectedPath === entry.path ? ' is-selected' : ''}`}
              onClick={() => onSelect(entry)}
              title={entry.path}
            >
              <span className="file-tree-icon file">◻</span>
              <span className="file-tree-name">{entry.path}</span>
            </button>
          ))
        ) : (
          <TreeBranch
            directory=""
            depth={0}
            cache={cache}
            expanded={expanded}
            selectedPath={selectedPath}
            loadingDirectories={loadingDirectories}
            onToggle={toggleDirectory}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}
