import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContextSets } from './useContextSets.js';

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
});
