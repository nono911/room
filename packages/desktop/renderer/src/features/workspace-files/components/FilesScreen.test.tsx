import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  it('clears stale previews when the ROOM route section changes', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.readRoomFile.mockResolvedValue({ success: true, content: '# Accepted decision' });
    const props = {
      projectPath: '/mock/project',
      projectData,
      initialSelectedFile: { section: 'decisions' as const, file: '0001-storage.md' },
      setInitialSelectedFile: vi.fn(),
      setErrorMsg: vi.fn(),
      onAddContext: vi.fn(),
      initialTab: 'room' as const
    };
    const view = render(<FilesScreen {...props} roomSection="decisions" />);

    await waitFor(() => expect(screen.getByText('Accepted decision')).toBeDefined());
    view.rerender(
      <FilesScreen
        {...props}
        initialSelectedFile={null}
        roomSection="reviews"
      />
    );

    await waitFor(() => expect(screen.queryByText('Accepted decision')).toBeNull());
  });

  it('restores the saved source file when returning from a ROOM route', async () => {
    const mockApi = window.electronAPI as any;
    localStorage.setItem('room:last-file:/mock/project', 'README.md');
    mockApi.readWorkspaceFile.mockResolvedValue({
      success: true,
      preview: {
        kind: 'text',
        content: '# Restored source',
        mimeType: 'text/markdown',
        language: 'markdown'
      }
    });
    const props = {
      projectPath: '/mock/project',
      projectData,
      initialSelectedFile: null,
      setInitialSelectedFile: vi.fn(),
      setErrorMsg: vi.fn(),
      onAddContext: vi.fn()
    };
    const view = render(
      <FilesScreen {...props} initialTab="room" roomSection="documents" />
    );

    view.rerender(<FilesScreen {...props} initialTab="source" />);

    await waitFor(() => {
      expect(mockApi.readWorkspaceFile).toHaveBeenCalledWith('/mock/project', 'README.md');
      expect(screen.getByText('Restored source')).toBeDefined();
    });
  });

  it('ignores stale preview responses after a newer file is selected', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.browseWorkspaceFiles.mockResolvedValue({
      success: true,
      files: [
        {
          path: 'A.md',
          name: 'A.md',
          size: 10,
          modifiedAt: '',
          kind: 'file',
          extension: 'md'
        },
        {
          path: 'B.md',
          name: 'B.md',
          size: 10,
          modifiedAt: '',
          kind: 'file',
          extension: 'md'
        }
      ],
      truncated: false
    });
    const first = deferred<{ success: true; preview: { kind: 'text'; content: string; mimeType: string; language: string } }>();
    const second = deferred<{ success: true; preview: { kind: 'text'; content: string; mimeType: string; language: string } }>();
    mockApi.readWorkspaceFile.mockImplementation((_projectPath: string, filePath: string) => (
      filePath === 'A.md' ? first.promise : second.promise
    ));

    render(
      <FilesScreen
        projectPath="/mock/project"
        projectData={projectData}
        initialSelectedFile={null}
        setInitialSelectedFile={vi.fn()}
        setErrorMsg={vi.fn()}
        onAddContext={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('A.md')).toBeDefined());
    fireEvent.click(screen.getByText('A.md'));
    fireEvent.click(screen.getByText('B.md'));
    await act(async () => {
      second.resolve({
        success: true,
        preview: { kind: 'text', content: '# Preview B', mimeType: 'text/markdown', language: 'markdown' }
      });
    });
    await waitFor(() => expect(screen.getByText('Preview B')).toBeDefined());
    await act(async () => {
      first.resolve({
        success: true,
        preview: { kind: 'text', content: '# Preview A', mimeType: 'text/markdown', language: 'markdown' }
      });
    });

    expect(screen.getByText('Preview B')).toBeDefined();
    expect(screen.queryByText('Preview A')).toBeNull();
  });
});
