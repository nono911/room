import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle.js';

const source = {
  id: 'source_123',
  name: 'example',
  path: '/example',
  attachedAt: '2026-01-01T00:00:00.000Z'
};

describe('useWorkspaceLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.electronAPI.initializePersonalRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      room: { id: 'room_personal', name: 'Personal Room', sources: [] }
    });
  });

  it('opens Personal Room immediately without a Source', async () => {
    const loadProjectData = vi.fn().mockResolvedValue(true);
    const restoreWorkspaceRoute = vi.fn();
    const { result } = renderHook(() => useWorkspaceLifecycle({
      clearWorkspaceDerivedState: vi.fn(),
      restoreWorkspaceRoute,
      loadProjectData,
      setLoading: vi.fn(),
      setErrorMsg: vi.fn()
    }));

    await waitFor(() => expect(result.current.initializingRoom).toBe(false));
    expect(result.current.roomId).toBe('room_personal');
    expect(result.current.activeSource).toBeNull();
    expect(restoreWorkspaceRoute).toHaveBeenCalledWith('room_personal');
    expect(loadProjectData).toHaveBeenCalledWith('room_personal');
  });

  it('attaches and detaches a Source while retaining the Room identity', async () => {
    const roomWithSource = {
      id: 'room_personal',
      name: 'Personal Room',
      sources: [source],
      activeSourceId: source.id
    };
    (window.electronAPI.attachRoomSource as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ success: true, room: roomWithSource });
    (window.electronAPI.detachRoomSource as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        success: true,
        room: { id: 'room_personal', name: 'Personal Room', sources: [] }
      });
    const loadProjectData = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useWorkspaceLifecycle({
      clearWorkspaceDerivedState: vi.fn(),
      restoreWorkspaceRoute: vi.fn(),
      loadProjectData,
      setLoading: vi.fn(),
      setErrorMsg: vi.fn()
    }));
    await waitFor(() => expect(result.current.initializingRoom).toBe(false));

    await act(async () => {
      await result.current.handleOpenProject();
    });
    expect(result.current.roomId).toBe('room_personal');
    expect(result.current.activeSource?.id).toBe(source.id);

    await act(async () => {
      await result.current.handleDetachSource();
    });
    expect(result.current.roomId).toBe('room_personal');
    expect(result.current.activeSource).toBeNull();
    expect(loadProjectData).toHaveBeenLastCalledWith('room_personal');
  });
});
