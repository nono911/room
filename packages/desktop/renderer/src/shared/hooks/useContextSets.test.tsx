import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContextSets } from './useContextSets.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useContextSets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads, saves, updates, and deletes context sets through the workspace API', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.loadContextSets.mockResolvedValue({
      success: true,
      contextSets: [{
        id: 'ctx-existing',
        name: 'Launch context',
        refs: ['workspace:overview'],
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z'
      }]
    });
    mockApi.saveContextSets.mockResolvedValue({ success: true });
    const setErrorMsg = vi.fn();
    const { result } = renderHook(() => useContextSets({
      projectPath: '/mock/project',
      setErrorMsg
    }));

    await waitFor(() => expect(result.current.contextSets).toHaveLength(1));

    await act(async () => {
      expect(await result.current.saveContextSet(
        'Launch context',
        ['workspace:overview', 'file:README.md']
      )).toBe(true);
    });
    expect(mockApi.saveContextSets).toHaveBeenLastCalledWith(
      '/mock/project',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ctx-existing',
          refs: ['workspace:overview', 'file:README.md']
        })
      ])
    );

    await act(async () => {
      expect(await result.current.deleteContextSet('ctx-existing')).toBe(true);
    });
    expect(mockApi.saveContextSets).toHaveBeenLastCalledWith('/mock/project', []);
    expect(setErrorMsg).not.toHaveBeenCalled();
  });

  it('ignores a stale workspace load and never persists its sets into the new workspace', async () => {
    const mockApi = window.electronAPI as any;
    const workspaceA = deferred<{ success: true; contextSets: Array<Record<string, unknown>> }>();
    const workspaceB = deferred<{ success: true; contextSets: Array<Record<string, unknown>> }>();
    mockApi.loadContextSets.mockImplementation((projectPath: string) => (
      projectPath === '/workspace/a' ? workspaceA.promise : workspaceB.promise
    ));
    mockApi.saveContextSets.mockResolvedValue({ success: true });
    const setErrorMsg = vi.fn();
    const { result, rerender } = renderHook(
      ({ projectPath }) => useContextSets({ projectPath, setErrorMsg }),
      { initialProps: { projectPath: '/workspace/a' } }
    );

    rerender({ projectPath: '/workspace/b' });
    await act(async () => {
      workspaceB.resolve({
        success: true,
        contextSets: [{
          id: 'ctx-b',
          name: 'Workspace B',
          refs: ['file:b.md'],
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        }]
      });
    });
    await waitFor(() => expect(result.current.contextSets[0]?.id).toBe('ctx-b'));

    await act(async () => {
      workspaceA.resolve({
        success: true,
        contextSets: [{
          id: 'ctx-a',
          name: 'Workspace A',
          refs: ['file:a.md'],
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        }]
      });
    });
    expect(result.current.contextSets.map(set => set.id)).toEqual(['ctx-b']);

    await act(async () => {
      expect(await result.current.saveContextSet('Workspace B', ['file:b-updated.md'])).toBe(true);
    });
    expect(mockApi.saveContextSets).toHaveBeenLastCalledWith(
      '/workspace/b',
      [expect.objectContaining({ id: 'ctx-b', refs: ['file:b-updated.md'] })]
    );
    expect(setErrorMsg).not.toHaveBeenCalled();
  });

  it('rejects a save while the initial context-set load is pending', async () => {
    const mockApi = window.electronAPI as any;
    const initialLoad = deferred<{
      success: true;
      contextSets: Array<Record<string, unknown>>;
    }>();
    mockApi.loadContextSets.mockReturnValue(initialLoad.promise);
    mockApi.saveContextSets.mockResolvedValue({ success: true });
    const setErrorMsg = vi.fn();
    const { result } = renderHook(() => useContextSets({
      projectPath: '/mock/project',
      setErrorMsg
    }));

    await waitFor(() => expect(result.current.contextSetsLoading).toBe(true));
    await act(async () => {
      expect(await result.current.saveContextSet('Too early', ['file:early.md'])).toBe(false);
    });
    expect(mockApi.saveContextSets).not.toHaveBeenCalled();

    await act(async () => {
      initialLoad.resolve({ success: true, contextSets: [] });
    });
    await waitFor(() => expect(result.current.contextSetsLoading).toBe(false));

    await act(async () => {
      expect(await result.current.saveContextSet('Ready', ['file:ready.md'])).toBe(true);
    });
    expect(mockApi.saveContextSets).toHaveBeenCalledWith(
      '/mock/project',
      [expect.objectContaining({ name: 'Ready', refs: ['file:ready.md'] })]
    );
    expect(setErrorMsg).not.toHaveBeenCalled();
  });

  it('serializes rapid deletes against the latest persisted context-set state', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.loadContextSets.mockResolvedValue({
      success: true,
      contextSets: [
        {
          id: 'ctx-a',
          name: 'Set A',
          refs: ['file:a.md'],
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        },
        {
          id: 'ctx-b',
          name: 'Set B',
          refs: ['file:b.md'],
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        }
      ]
    });
    const firstSave = deferred<{ success: true }>();
    const secondSave = deferred<{ success: true }>();
    mockApi.saveContextSets
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);
    const setErrorMsg = vi.fn();
    const { result } = renderHook(() => useContextSets({
      projectPath: '/mock/project',
      setErrorMsg
    }));

    await waitFor(() => expect(result.current.contextSets).toHaveLength(2));

    let deleteA!: Promise<boolean>;
    let deleteB!: Promise<boolean>;
    act(() => {
      deleteA = result.current.deleteContextSet('ctx-a');
      deleteB = result.current.deleteContextSet('ctx-b');
    });

    await waitFor(() => expect(mockApi.saveContextSets).toHaveBeenCalledTimes(1));
    expect(mockApi.saveContextSets).toHaveBeenNthCalledWith(
      1,
      '/mock/project',
      [expect.objectContaining({ id: 'ctx-b' })]
    );

    await act(async () => {
      firstSave.resolve({ success: true });
      expect(await deleteA).toBe(true);
    });
    await waitFor(() => expect(mockApi.saveContextSets).toHaveBeenCalledTimes(2));
    expect(mockApi.saveContextSets).toHaveBeenNthCalledWith(2, '/mock/project', []);

    await act(async () => {
      secondSave.resolve({ success: true });
      expect(await deleteB).toBe(true);
    });
    expect(result.current.contextSets).toEqual([]);
    expect(result.current.contextSetsMutating).toBe(false);
    expect(setErrorMsg).not.toHaveBeenCalled();
  });

  it('loads and mutates the next workspace independently of a pending prior mutation', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.loadContextSets.mockImplementation((projectPath: string) => Promise.resolve({
      success: true,
      contextSets: [{
        id: projectPath === '/workspace/a' ? 'ctx-a' : 'ctx-b',
        name: projectPath === '/workspace/a' ? 'Workspace A' : 'Workspace B',
        refs: [projectPath === '/workspace/a' ? 'file:a.md' : 'file:b.md'],
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z'
      }]
    }));
    const workspaceASave = deferred<{ success: true }>();
    mockApi.saveContextSets
      .mockReturnValueOnce(workspaceASave.promise)
      .mockResolvedValueOnce({ success: true });
    const setErrorMsg = vi.fn();
    const { result, rerender } = renderHook(
      ({ projectPath }) => useContextSets({ projectPath, setErrorMsg }),
      { initialProps: { projectPath: '/workspace/a' } }
    );

    await waitFor(() => expect(result.current.contextSets[0]?.id).toBe('ctx-a'));

    let workspaceAMutation!: Promise<boolean>;
    act(() => {
      workspaceAMutation = result.current.saveContextSet(
        'Workspace A',
        ['file:a-updated.md']
      );
    });
    await waitFor(() => expect(mockApi.saveContextSets).toHaveBeenCalledTimes(1));

    rerender({ projectPath: '/workspace/b' });
    await waitFor(() => expect(result.current.contextSets[0]?.id).toBe('ctx-b'));
    expect(mockApi.loadContextSets).toHaveBeenCalledWith('/workspace/b');
    await waitFor(() => expect(result.current.contextSetsMutating).toBe(false));

    await act(async () => {
      expect(await result.current.saveContextSet(
        'Workspace B',
        ['file:b-updated.md']
      )).toBe(true);
    });
    expect(mockApi.saveContextSets).toHaveBeenNthCalledWith(
      2,
      '/workspace/b',
      [expect.objectContaining({
        id: 'ctx-b',
        name: 'Workspace B',
        refs: ['file:b-updated.md']
      })]
    );

    await act(async () => {
      workspaceASave.resolve({ success: true });
      expect(await workspaceAMutation).toBe(false);
    });
    expect(result.current.contextSets).toEqual([
      expect.objectContaining({
        id: 'ctx-b',
        refs: ['file:b-updated.md']
      })
    ]);
    expect(setErrorMsg).not.toHaveBeenCalled();
  });

  it('prevents a stale reload from overwriting a completed mutation after returning to a workspace', async () => {
    const mockApi = window.electronAPI as any;
    const staleWorkspaceALoad = deferred<{
      success: true;
      contextSets: Array<Record<string, unknown>>;
    }>();
    let workspaceALoadCount = 0;
    mockApi.loadContextSets.mockImplementation((projectPath: string) => {
      if (projectPath === '/workspace/a') {
        workspaceALoadCount += 1;
        if (workspaceALoadCount > 1) return staleWorkspaceALoad.promise;
      }
      return Promise.resolve({
        success: true,
        contextSets: [{
          id: projectPath === '/workspace/a' ? 'ctx-a' : 'ctx-b',
          name: projectPath === '/workspace/a' ? 'Workspace A' : 'Workspace B',
          refs: [projectPath === '/workspace/a' ? 'file:a.md' : 'file:b.md'],
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        }]
      });
    });
    const firstSave = deferred<{ success: true }>();
    mockApi.saveContextSets
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce({ success: true });
    const setErrorMsg = vi.fn();
    const { result, rerender } = renderHook(
      ({ projectPath }) => useContextSets({ projectPath, setErrorMsg }),
      { initialProps: { projectPath: '/workspace/a' } }
    );

    await waitFor(() => expect(result.current.contextSets[0]?.id).toBe('ctx-a'));

    let firstMutation!: Promise<boolean>;
    act(() => {
      firstMutation = result.current.saveContextSet(
        'Workspace A',
        ['file:a-saved.md']
      );
    });
    await waitFor(() => expect(mockApi.saveContextSets).toHaveBeenCalledTimes(1));

    rerender({ projectPath: '/workspace/b' });
    await waitFor(() => expect(result.current.contextSets[0]?.id).toBe('ctx-b'));
    rerender({ projectPath: '/workspace/a' });
    await waitFor(() => expect(workspaceALoadCount).toBe(2));

    await act(async () => {
      firstSave.resolve({ success: true });
      expect(await firstMutation).toBe(true);
    });
    expect(result.current.contextSets).toEqual([
      expect.objectContaining({
        id: 'ctx-a',
        refs: ['file:a-saved.md']
      })
    ]);

    await act(async () => {
      staleWorkspaceALoad.resolve({
        success: true,
        contextSets: [{
          id: 'ctx-a',
          name: 'Workspace A',
          refs: ['file:a-stale.md'],
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        }]
      });
    });
    expect(result.current.contextSets[0]?.refs).toEqual(['file:a-saved.md']);

    await act(async () => {
      expect(await result.current.saveContextSet(
        'Workspace A',
        ['file:a-final.md']
      )).toBe(true);
    });
    expect(mockApi.saveContextSets).toHaveBeenNthCalledWith(
      2,
      '/workspace/a',
      [expect.objectContaining({
        id: 'ctx-a',
        refs: ['file:a-final.md']
      })]
    );
    expect(setErrorMsg).not.toHaveBeenCalled();
  });
});
