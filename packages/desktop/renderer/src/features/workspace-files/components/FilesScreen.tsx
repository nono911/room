import { useEffect, useState } from 'react';
import type { ProjectData, WorkspaceFileEntry, WorkspaceFilePreview } from '../../../types/domain.js';
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

  useEffect(() => {
    setSelectedSource(null);
    setSelectedArtifact(null);
    setPreview(null);
    setTab(initialTab);
  }, [projectPath, initialTab]);

  const openSourceFile = async (file: WorkspaceFileEntry) => {
    if (!projectPath) return;
    setLoading(true);
    setSelectedSource(file);
    setSelectedArtifact(null);
    setErrorMsg(null);
    try {
      const result = await api.readWorkspaceFile(projectPath, file.path);
      if (!result.success || !result.preview) {
        setPreview(null);
        setErrorMsg(result.error || `Failed to preview ${file.path}.`);
        return;
      }
      setPreview(result.preview);
      localStorage.setItem(`room:last-file:${projectPath}`, file.path);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : `Failed to preview ${file.path}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectPath || initialTab !== 'source') return;
    const lastPath = localStorage.getItem(`room:last-file:${projectPath}`);
    if (!lastPath) return;
    void openSourceFile({
      path: lastPath,
      name: lastPath.split('/').pop() || lastPath,
      size: 0,
      modifiedAt: '',
      kind: 'file',
      extension: lastPath.split('.').pop()?.toLowerCase()
    });
  }, [projectPath]);

  useEffect(() => {
    setRefreshToken(value => value + 1);
  }, [projectData?.taskRuns?.length, projectData?.discussions.length]);

  const openArtifact = async (selection: RoomArtifactSelection) => {
    if (!projectPath) return;
    setLoading(true);
    setSelectedArtifact(selection);
    setSelectedSource(null);
    setErrorMsg(null);
    try {
      const result = await api.readRoomFile(projectPath, selection.section, selection.file);
      if (!result.success) {
        setPreview(null);
        setErrorMsg(result.error || `Failed to preview ${selection.file}.`);
        return;
      }
      setPreview(roomPreview(result.content || '', selection.file));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : `Failed to preview ${selection.file}.`);
    } finally {
      setLoading(false);
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

  const revealSource = async () => {
    if (!projectPath || !selectedSource) return;
    const result = await api.revealWorkspaceFile(projectPath, selectedSource.path);
    if (!result.success) setErrorMsg(result.error || 'Failed to reveal the selected file.');
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
        <button type="button" className="btn-secondary" onClick={() => setRefreshToken(value => value + 1)}>
          Refresh source
        </button>
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
        {projectPath && tab === 'source' ? (
          <WorkspaceFileTree
            projectPath={projectPath}
            selectedPath={selectedSource?.path || null}
            refreshToken={refreshToken}
            onSelect={(file) => void openSourceFile(file)}
            onError={setErrorMsg}
          />
        ) : (
          <RoomArtifactList
            projectData={projectData}
            selected={selectedArtifact}
            onSelect={(selection) => void openArtifact(selection)}
            onlySection={roomSection}
          />
        )}
        <FilePreviewPane
          title={selectedTitle}
          subtitle={selectedPath}
          preview={preview}
          loading={loading}
          canReveal={!!selectedSource}
          canAddContext={!!selectedSource}
          onCopyPath={selectedPath ? () => void copyPath() : undefined}
          onReveal={() => void revealSource()}
          onAddContext={selectedSource ? () => onAddContext(`file:${selectedSource.path}`) : undefined}
        />
      </div>
    </div>
  );
}
