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
const sourceProps = {
  activeSourceId: 'source_test',
  onAttachSource: vi.fn()
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

  it('shows an Attach Source empty state without calling source IPC', async () => {
    const onAttachSource = vi.fn();
    render(
      <FilesScreen
        projectPath="room_personal"
        onAttachSource={onAttachSource}
        projectData={projectData}
        initialSelectedFile={null}
        setInitialSelectedFile={vi.fn()}
        setErrorMsg={vi.fn()}
        onAddContext={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'No Source attached' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Attach Source folder' }));
    expect(onAttachSource).toHaveBeenCalledOnce();
    expect(window.electronAPI.browseWorkspaceFiles).not.toHaveBeenCalled();
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
        {...sourceProps}
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
    expect(onAddContext).toHaveBeenCalledWith('source-file:source_test:README.md');
  });

  it('opens decisions in the shared ROOM artifact viewer', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.readRoomFile.mockResolvedValue({ success: true, content: '# Accepted decision' });
    render(
      <FilesScreen
        {...sourceProps}
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

  it('loads additional ROOM artifact pages without reloading Home', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.listRoomArtifacts.mockResolvedValue({
      success: true,
      files: ['0002-follow-up.md'],
      hasMore: false,
      truncated: false
    });
    render(
      <FilesScreen
        {...sourceProps}
        projectPath="room_personal"
        projectData={{
          ...projectData,
          artifactListPagination: {
            decisions: {
              hasMore: true,
              nextCursor: 'cursor-page-1',
              truncated: false
            }
          }
        }}
        initialSelectedFile={null}
        setInitialSelectedFile={vi.fn()}
        setErrorMsg={vi.fn()}
        onAddContext={vi.fn()}
        initialTab="room"
        roomSection="decisions"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load more decisions' }));
    await waitFor(() => expect(screen.getByText('0002-follow-up.md')).toBeDefined());
    expect(mockApi.listRoomArtifacts).toHaveBeenCalledWith(
      'room_personal',
      'decisions',
      'cursor-page-1'
    );
    expect(screen.queryByRole('button', { name: 'Load more decisions' })).toBeNull();
  });

  it('clears stale previews when the ROOM route section changes', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.readRoomFile.mockResolvedValue({ success: true, content: '# Accepted decision' });
    const props = {
      ...sourceProps,
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
    localStorage.setItem('room:last-file:/mock/project:source_test', 'README.md');
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
      ...sourceProps,
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
      expect(mockApi.readWorkspaceFile).toHaveBeenCalledWith('/mock/project', 'source_test', 'README.md');
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
    mockApi.readWorkspaceFile.mockImplementation((_roomId: string, _sourceId: string, filePath: string) => (
      filePath === 'A.md' ? first.promise : second.promise
    ));

    render(
      <FilesScreen
        {...sourceProps}
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

  it('invalidates a preview and remembered path when the active Source changes', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.browseWorkspaceFiles.mockResolvedValue({
      success: true,
      files: [{
        path: 'README.md',
        name: 'README.md',
        size: 10,
        modifiedAt: '',
        kind: 'file',
        extension: 'md'
      }],
      truncated: false
    });
    const pending = deferred<{
      success: true;
      preview: { kind: 'text'; content: string; mimeType: string; language: string };
    }>();
    mockApi.readWorkspaceFile.mockReturnValue(pending.promise);
    const props = {
      projectPath: '/mock/project',
      projectData,
      initialSelectedFile: null,
      setInitialSelectedFile: vi.fn(),
      setErrorMsg: vi.fn(),
      onAddContext: vi.fn(),
      onAttachSource: vi.fn()
    };
    const view = render(<FilesScreen {...props} activeSourceId="source_first" />);
    await waitFor(() => expect(screen.getByText('README.md')).toBeDefined());
    fireEvent.click(screen.getByText('README.md'));
    view.rerender(<FilesScreen {...props} activeSourceId="source_second" />);
    await act(async () => {
      pending.resolve({
        success: true,
        preview: {
          kind: 'text',
          content: '# Detached Source',
          mimeType: 'text/markdown',
          language: 'markdown'
        }
      });
    });
    expect(screen.queryByText('Detached Source')).toBeNull();
    expect(localStorage.getItem('room:last-file:/mock/project:source_second')).toBeNull();
  });
});
