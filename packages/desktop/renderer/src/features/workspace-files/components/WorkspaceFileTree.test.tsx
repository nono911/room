import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceFileEntry } from '../../../types/domain.js';
import { WorkspaceFileTree } from './WorkspaceFileTree.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function file(name: string): WorkspaceFileEntry {
  return {
    path: name,
    name,
    size: 10,
    modifiedAt: '',
    kind: 'file',
    extension: 'md'
  };
}

describe('WorkspaceFileTree request generations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not let a previous workspace response replace the active tree', async () => {
    const mockApi = window.electronAPI as any;
    const workspaceA = deferred<{ success: true; files: WorkspaceFileEntry[]; truncated: false }>();
    const workspaceB = deferred<{ success: true; files: WorkspaceFileEntry[]; truncated: false }>();
    mockApi.browseWorkspaceFiles.mockImplementation((projectPath: string) => (
      projectPath === '/workspace/a' ? workspaceA.promise : workspaceB.promise
    ));
    const props = {
      sourceId: 'source_test',
      selectedPath: null,
      refreshToken: 0,
      onSelect: vi.fn(),
      onError: vi.fn()
    };
    const view = render(<WorkspaceFileTree {...props} projectPath="/workspace/a" />);

    view.rerender(<WorkspaceFileTree {...props} projectPath="/workspace/b" />);
    await waitFor(() => expect(mockApi.browseWorkspaceFiles).toHaveBeenCalledTimes(2));
    await act(async () => {
      workspaceB.resolve({ success: true, files: [file('b.md')], truncated: false });
    });
    await waitFor(() => expect(screen.getByText('b.md')).toBeDefined());
    await act(async () => {
      workspaceA.resolve({ success: true, files: [file('a.md')], truncated: false });
    });

    expect(screen.getByText('b.md')).toBeDefined();
    expect(screen.queryByText('a.md')).toBeNull();
  });

  it('does not let an older refresh replace newer root results', async () => {
    const mockApi = window.electronAPI as any;
    const first = deferred<{ success: true; files: WorkspaceFileEntry[]; truncated: false }>();
    const second = deferred<{ success: true; files: WorkspaceFileEntry[]; truncated: false }>();
    mockApi.browseWorkspaceFiles
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const props = {
      sourceId: 'source_test',
      projectPath: '/workspace/a',
      selectedPath: null,
      onSelect: vi.fn(),
      onError: vi.fn()
    };
    const view = render(<WorkspaceFileTree {...props} refreshToken={0} />);

    view.rerender(<WorkspaceFileTree {...props} refreshToken={1} />);
    await waitFor(() => expect(mockApi.browseWorkspaceFiles).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve({ success: true, files: [file('fresh.md')], truncated: false });
    });
    await waitFor(() => expect(screen.getByText('fresh.md')).toBeDefined());
    await act(async () => {
      first.resolve({ success: true, files: [file('stale.md')], truncated: false });
    });

    expect(screen.getByText('fresh.md')).toBeDefined();
    expect(screen.queryByText('stale.md')).toBeNull();
  });

  it('stops showing search activity when an in-flight query is cleared', async () => {
    const mockApi = window.electronAPI as any;
    const search = deferred<{ success: true; files: WorkspaceFileEntry[]; truncated: false }>();
    mockApi.browseWorkspaceFiles
      .mockResolvedValueOnce({ success: true, files: [file('root.md')], truncated: false })
      .mockReturnValueOnce(search.promise);
    render(
      <WorkspaceFileTree
        projectPath="/workspace/a"
        sourceId="source_test"
        selectedPath={null}
        refreshToken={0}
        onSelect={vi.fn()}
        onError={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('root.md')).toBeDefined());
    const input = screen.getByPlaceholderText('Search the full source…');
    fireEvent.change(input, { target: { value: 'notes' } });
    await waitFor(() => expect(screen.getByText('Searching source…')).toBeDefined());

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('Attached source')).toBeDefined());

    await act(async () => {
      search.resolve({ success: true, files: [file('notes.md')], truncated: false });
    });
    expect(screen.getByText('Attached source')).toBeDefined();
    expect(screen.queryByText('notes.md')).toBeNull();
  });
});
