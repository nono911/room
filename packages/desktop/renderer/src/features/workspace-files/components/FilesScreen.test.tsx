import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesScreen } from './FilesScreen.js';

const projectData = {
  projectMd: '',
  archMd: '',
  tasks: [],
  taskRuns: [],
  decisions: ['0001-storage.md'],
  reviews: [],
  documents: [],
  discussions: [],
  skills: [],
  agents: []
};

describe('FilesScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('browses source lazily, previews markdown, and adds the selected file to context', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.browseWorkspaceFiles.mockResolvedValue({
      success: true,
      files: [{
        path: 'README.md',
        name: 'README.md',
        size: 120,
        modifiedAt: '2026-07-23T00:00:00.000Z',
        kind: 'file',
        extension: 'md'
      }],
      truncated: false
    });
    mockApi.readWorkspaceFile.mockResolvedValue({
      success: true,
      preview: {
        kind: 'text',
        content: '# ROOM source',
        mimeType: 'text/markdown',
        language: 'markdown'
      }
    });
    const onAddContext = vi.fn();

    render(
      <FilesScreen
        projectPath="/mock/project"
        projectData={projectData}
        initialSelectedFile={null}
        setInitialSelectedFile={vi.fn()}
        setErrorMsg={vi.fn()}
        onAddContext={onAddContext}
      />
    );

    await waitFor(() => expect(screen.getByText('README.md')).toBeDefined());
    fireEvent.click(screen.getByText('README.md'));
    await waitFor(() => expect(screen.getByText('ROOM source')).toBeDefined());
    fireEvent.click(screen.getByText('Add context'));
    expect(onAddContext).toHaveBeenCalledWith('file:README.md');
  });

  it('opens decisions in the shared ROOM artifact viewer', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.readRoomFile.mockResolvedValue({ success: true, content: '# Accepted decision' });
    render(
      <FilesScreen
        projectPath="/mock/project"
        projectData={projectData}
        initialSelectedFile={{ section: 'decisions', file: '0001-storage.md' }}
        setInitialSelectedFile={vi.fn()}
        setErrorMsg={vi.fn()}
        onAddContext={vi.fn()}
        initialTab="room"
        roomSection="decisions"
      />
    );

    await waitFor(() => expect(screen.getByText('Accepted decision')).toBeDefined());
    expect(mockApi.readRoomFile).toHaveBeenCalledWith(
      '/mock/project',
      'decisions',
      '0001-storage.md'
    );
  });
});
