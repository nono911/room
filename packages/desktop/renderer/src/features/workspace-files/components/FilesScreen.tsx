import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProjectData,
  RoomListPageState,
  SourceGitStatus,
  WorkspaceFileEntry,
  WorkspaceFilePreview
} from '../../../types/domain.js';
import { api } from '../../../shared/ipc/client.js';
import { FilePreviewPane } from './FilePreviewPane.js';
import {
  RoomArtifactList,
  type RoomArtifactSection,
  type RoomArtifactSelection
} from './RoomArtifactList.js';
import { WorkspaceFileTree } from './WorkspaceFileTree.js';

interface FilesScreenProps {
  projectPath: string | null;
  activeSourceId?: string;
  onAttachSource: () => void;
  projectData: ProjectData | null;
  initialSelectedFile: RoomArtifactSelection | null;
  setInitialSelectedFile: (value: RoomArtifactSelection | null) => void;
  setErrorMsg: (value: string | null) => void;
  onAddContext: (ref: string) => void;
  initialTab?: 'source' | 'room';
  roomSection?: RoomArtifactSection;
}

function roomPreview(content: string, file: string): WorkspaceFilePreview {
  return {
    kind: 'text',
    content,
    mimeType: file.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain',
    language: file.toLowerCase().endsWith('.md') ? 'markdown' : undefined
  };
}

export function FilesScreen({
  projectPath,
  activeSourceId,
  onAttachSource,
  projectData,
  initialSelectedFile,
  setInitialSelectedFile,
  setErrorMsg,
  onAddContext,
  initialTab = 'source',
  roomSection
}: FilesScreenProps) {
  const [tab, setTab] = useState<'source' | 'room'>(initialTab);
  const [selectedSource, setSelectedSource] = useState<WorkspaceFileEntry | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<RoomArtifactSelection | null>(null);
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [gitStatus, setGitStatus] = useState<SourceGitStatus | null>(null);
  const [extraArtifacts, setExtraArtifacts] = useState<
    Partial<Record<RoomArtifactSection, string[]>>
  >({});
  const [artifactPagination, setArtifactPagination] = useState<
    Partial<Record<RoomArtifactSection, RoomListPageState>>
  >({});
  const [loadingArtifactSection, setLoadingArtifactSection] =
    useState<RoomArtifactSection | null>(null);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    setExtraArtifacts({});
    setArtifactPagination(projectData?.artifactListPagination || {});
    setLoadingArtifactSection(null);
  }, [projectPath, projectData]);

  const artifactProjectData = useMemo(() => {
    if (!projectData) return null;
    const merge = (section: RoomArtifactSection) => Array.from(new Set([
      ...(projectData[section] || []),
      ...(extraArtifacts[section] || [])
    ])).sort((left, right) => left.localeCompare(right));
    return {
      ...projectData,
      documents: merge('documents'),
      reviews: merge('reviews'),
      discussions: merge('discussions'),
      tasks: merge('tasks'),
      decisions: merge('decisions')
    };
  }, [projectData, extraArtifacts]);

  const loadMoreArtifacts = async (section: RoomArtifactSection) => {
    if (!projectPath || loadingArtifactSection) return;
    const pageState = artifactPagination[section];
    if (!pageState?.hasMore || pageState.truncated) return;
    setLoadingArtifactSection(section);
    setErrorMsg(null);
    try {
      const result = await api.listRoomArtifacts(
        projectPath,
        section,
        pageState.nextCursor
      );
      if (!result.success) {
        setErrorMsg(result.error || `Failed to load more ${section}.`);
        return;
      }
      setExtraArtifacts(previous => ({
        ...previous,
        [section]: Array.from(new Set([
          ...(previous[section] || []),
          ...(result.files || [])
        ]))
      }));
      setArtifactPagination(previous => ({
        ...previous,
        [section]: {
          hasMore: Boolean(result.hasMore),
          nextCursor: result.nextCursor,
          truncated: Boolean(result.truncated)
        }
      }));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : `Failed to load more ${section}.`);
    } finally {
      setLoadingArtifactSection(null);
    }
  };

  useEffect(() => {
    previewRequestRef.current += 1;
    setSelectedSource(null);
    setSelectedArtifact(null);
    setPreview(null);
    setTab(initialTab);
    setLoading(false);
    setGitStatus(null);
  }, [projectPath, activeSourceId, initialTab, roomSection]);

  useEffect(() => {
    if (!projectPath || !activeSourceId) return;
    let cancelled = false;
    void api.getSourceGitStatus(projectPath, activeSourceId).then(result => {
      if (!cancelled) setGitStatus(result.success && result.git ? result.git : null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, activeSourceId, refreshToken]);

  const openSourceFile = async (file: WorkspaceFileEntry) => {
    if (!projectPath || !activeSourceId) return;
    const requestId = ++previewRequestRef.current;
    setLoading(true);
    setSelectedSource(file);
    setSelectedArtifact(null);
    setErrorMsg(null);
    try {
      const result = await api.readWorkspaceFile(projectPath, activeSourceId, file.path);
      if (requestId !== previewRequestRef.current) return;
      if (!result.success || !result.preview) {
        setPreview(null);
        setErrorMsg(result.error || `Failed to preview ${file.path}.`);
        return;
      }
      setPreview(result.preview);
      localStorage.setItem(`room:last-file:${projectPath}:${activeSourceId}`, file.path);
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setErrorMsg(error instanceof Error ? error.message : `Failed to preview ${file.path}.`);
    } finally {
      if (requestId === previewRequestRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!projectPath || !activeSourceId || initialTab !== 'source') return;
    const lastPath = localStorage.getItem(`room:last-file:${projectPath}:${activeSourceId}`);
    if (!lastPath) return;
    void openSourceFile({
      path: lastPath,
      name: lastPath.split('/').pop() || lastPath,
      size: 0,
      modifiedAt: '',
      kind: 'file',
      extension: lastPath.split('.').pop()?.toLowerCase()
    });
  }, [projectPath, activeSourceId, initialTab]);

  useEffect(() => {
    setRefreshToken(value => value + 1);
  }, [projectData?.taskRuns?.length, projectData?.discussions.length]);

  const openArtifact = async (selection: RoomArtifactSelection) => {
    if (!projectPath) return;
    const requestId = ++previewRequestRef.current;
    setLoading(true);
    setSelectedArtifact(selection);
    setSelectedSource(null);
    setErrorMsg(null);
    try {
      const result = await api.readRoomFile(projectPath, selection.section, selection.file);
      if (requestId !== previewRequestRef.current) return;
      if (!result.success) {
        setPreview(null);
        setErrorMsg(result.error || `Failed to preview ${selection.file}.`);
        return;
      }
      setPreview(roomPreview(result.content || '', selection.file));
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setErrorMsg(error instanceof Error ? error.message : `Failed to preview ${selection.file}.`);
    } finally {
      if (requestId === previewRequestRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!initialSelectedFile) return;
    setTab('room');
    void openArtifact(initialSelectedFile);
    setInitialSelectedFile(null);
  }, [initialSelectedFile]);

  const selectedTitle = selectedSource?.name || selectedArtifact?.file || null;
  const selectedPath = selectedSource?.path || (
    selectedArtifact ? `ROOM Home / ${selectedArtifact.section} / ${selectedArtifact.file}` : undefined
  );

  const copyPath = async () => {
    if (!selectedPath) return;
    await navigator.clipboard.writeText(selectedPath);
  };

  return (
    <div className="unified-files-screen">
      <header className="workspace-page-header compact">
        <div>
          <span className="workspace-page-eyebrow">Knowledge</span>
          <h1>Files & artifacts</h1>
          <p>{roomSection
            ? `Browse ${roomSection} through the same durable viewer used across ROOM.`
            : 'Browse the attached source and every durable output ROOM has created.'}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {activeSourceId && (
            <span className="source-git-status">
              {gitStatus?.repository
                ? `Git · ${gitStatus.branch || 'detached'}${gitStatus.commit ? ` · ${gitStatus.commit}` : ''}`
                : gitStatus?.unsupportedReason
                  ? 'Git · linked worktree unsupported'
                  : 'Git · not a repository'}
            </span>
          )}
          <button type="button" className="btn-secondary" onClick={() => setRefreshToken(value => value + 1)}>
            Refresh source
          </button>
        </div>
      </header>
      <div className="file-source-tabs" role="tablist" aria-label="File source">
        <button type="button" className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>
          Attached source
        </button>
        <button type="button" className={tab === 'room' ? 'active' : ''} onClick={() => setTab('room')}>
          ROOM artifacts
        </button>
      </div>
      <div className="unified-file-layout">
        {projectPath && activeSourceId && tab === 'source' ? (
          <WorkspaceFileTree
            projectPath={projectPath}
            sourceId={activeSourceId}
            selectedPath={selectedSource?.path || null}
            refreshToken={refreshToken}
            onSelect={(file) => void openSourceFile(file)}
            onError={setErrorMsg}
          />
        ) : tab === 'source' ? (
          <div className="source-empty-state">
            <span className="source-empty-icon">⌁</span>
            <h2>No Source attached</h2>
            <p>Room memory and artifacts are ready. Attach a folder when you want to browse files, search code, scan, or run coding actions.</p>
            <button type="button" className="btn-primary" onClick={onAttachSource}>
              Attach Source folder
            </button>
          </div>
        ) : (
          <RoomArtifactList
            projectData={artifactProjectData}
            selected={selectedArtifact}
            onSelect={(selection) => void openArtifact(selection)}
            onlySection={roomSection}
            hasMore={Object.fromEntries(
              Object.entries(artifactPagination).map(([section, state]) => [
                section,
                state?.hasMore
              ])
            )}
            truncated={Object.fromEntries(
              Object.entries(artifactPagination).map(([section, state]) => [
                section,
                state?.truncated
              ])
            )}
            loadingSection={loadingArtifactSection}
            onLoadMore={(section) => void loadMoreArtifacts(section)}
          />
        )}
        <FilePreviewPane
          title={selectedTitle}
          subtitle={selectedPath}
          preview={preview}
          loading={loading}
          canAddContext={!!selectedSource}
          onCopyPath={selectedPath ? () => void copyPath() : undefined}
          onAddContext={selectedSource && activeSourceId
            ? () => onAddContext(`source-file:${activeSourceId}:${encodeURIComponent(selectedSource.path)}`)
            : undefined}
        />
      </div>
    </div>
  );
}
