import React, { useState, useEffect } from 'react';
import type { WorkspaceFileEntry } from '../../../types/domain.js';
import { api } from '../../../shared/ipc/client.js';

interface FilesScreenProps {
  projectPath: string | null;
  setErrorMsg: (value: string | null) => void;
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FilesScreen: React.FC<FilesScreenProps> = ({
  projectPath,
  setErrorMsg
}) => {
  const [workspaceFileSearch, setWorkspaceFileSearch] = useState<string>('');
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [workspaceFilesTruncated, setWorkspaceFilesTruncated] = useState<boolean>(false);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<string | null>(null);
  const [selectedWorkspaceFileContent, setSelectedWorkspaceFileContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const loadWorkspaceFiles = async (pathStr: string) => {
    try {
      const fileRes = await api.listWorkspaceFiles(pathStr);
      if (fileRes.success) {
        setWorkspaceFiles(fileRes.files || []);
        setWorkspaceFilesTruncated(!!fileRes.truncated);
      } else {
        setWorkspaceFiles([]);
        setWorkspaceFilesTruncated(false);
        setErrorMsg(fileRes.error || 'Failed to load workspace files.');
      }
    } catch (err) {
      console.error('Error loading workspace files:', err);
    }
  };

  useEffect(() => {
    if (projectPath) {
      loadWorkspaceFiles(projectPath);
    } else {
      setWorkspaceFiles([]);
      setWorkspaceFilesTruncated(false);
    }
    setSelectedWorkspaceFile(null);
    setSelectedWorkspaceFileContent('');
  }, [projectPath]);

  const loadWorkspaceFilePreview = async (filePath: string) => {
    if (!projectPath || !filePath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.readWorkspaceFile(projectPath, filePath);
      setSelectedWorkspaceFile(filePath);
      if (res.success) {
        setSelectedWorkspaceFileContent(res.content || '');
      } else {
        setSelectedWorkspaceFileContent(`Failed to load file preview:\n${res.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to load ${filePath}.`);
    } finally {
      setLoading(false);
    }
  };

  const query = workspaceFileSearch.trim().toLowerCase();
  const visibleFiles = query
    ? workspaceFiles.filter(file => file.path.toLowerCase().includes(query))
    : workspaceFiles;
  const visibleFolderCount = visibleFiles.filter(file => file.kind === 'directory').length;
  const visibleFileCount = visibleFiles.length - visibleFolderCount;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '24px', minHeight: '560px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <input
            type="search"
            value={workspaceFileSearch}
            onChange={(e) => setWorkspaceFileSearch(e.target.value)}
            disabled={loading}
            placeholder="Search workspace files and folders..."
            style={{
              backgroundColor: 'hsl(var(--bg-input))',
              border: '1px solid hsl(var(--border-dim))',
              borderRadius: '8px',
              padding: '10px 12px',
              color: 'white',
              fontFamily: 'inherit',
              outline: 'none'
            }}
          />
          <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.78rem' }}>
            {visibleFolderCount} folders, {visibleFileCount} files{workspaceFilesTruncated ? ' shown. Large workspaces are limited to the first 500 items.' : ''}
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '520px',
          overflowY: 'auto',
          paddingRight: '4px'
        }}>
          {visibleFiles.length === 0 ? (
            <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No workspace files or folders found.</div>
          ) : (
            visibleFiles.map((file) => {
              const selected = selectedWorkspaceFile === file.path;
              const isDirectory = file.kind === 'directory';
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => loadWorkspaceFilePreview(file.path)}
                  disabled={loading}
                  style={{
                    background: selected ? 'hsl(var(--accent-purple) / 0.14)' : 'hsl(var(--bg-card))',
                    border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    color: 'inherit',
                    textAlign: 'left',
                    font: 'inherit',
                    minWidth: 0
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span style={{ color: isDirectory ? 'hsl(var(--accent-blue))' : 'hsl(var(--text-muted))', fontSize: '0.78rem', fontWeight: 750 }}>
                      {isDirectory ? '[dir]' : '[file]'}
                    </span>
                    <span style={{ fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {file.path}
                    </span>
                  </div>
                  <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem', marginTop: '4px' }}>
                    {isDirectory ? 'Folder' : formatFileSize(file.size)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', minHeight: '20px', wordBreak: 'break-all' }}>
          {selectedWorkspaceFile || 'Select a file or folder to preview.'}
        </div>
        <pre className="markdown-preview" style={{
          maxHeight: 'none',
          height: '520px',
          fontSize: '0.86rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0
        }}>
          {selectedWorkspaceFileContent || '# Select a workspace file or folder to preview.'}
        </pre>
      </div>
    </div>
  );
};
