import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle.js';

describe('useWorkspaceLifecycle', () => {
  it('returns false for ROOM projects when project data reload fails', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.openProjectDir.mockResolvedValue({
      success: true,
      path: '/mock/project',
      isRoomProject: true
    });

    const loadProjectData = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() => useWorkspaceLifecycle({
      clearWorkspaceDerivedState: vi.fn(),
      loadProjectData,
      setLoading: vi.fn(),
      setErrorMsg: vi.fn()
    }));

    let reopened = true;
    await act(async () => {
      reopened = await result.current.handleSelectRecentProject('/mock/project');
    });

    expect(reopened).toBe(false);
    expect(loadProjectData).toHaveBeenCalledWith('/mock/project');
  });

  it('returns true for ROOM projects when project data reload succeeds', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.openProjectDir.mockResolvedValue({
      success: true,
      path: '/mock/project',
      isRoomProject: true
    });

    const loadProjectData = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useWorkspaceLifecycle({
      clearWorkspaceDerivedState: vi.fn(),
      loadProjectData,
      setLoading: vi.fn(),
      setErrorMsg: vi.fn()
    }));

    let reopened = false;
    await act(async () => {
      reopened = await result.current.handleSelectRecentProject('/mock/project');
    });

    expect(reopened).toBe(true);
  });
});
