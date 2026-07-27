import { useEffect, useMemo, useState } from 'react';
import type { RoomSummary } from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';

interface UseWorkspaceLifecycleOptions {
  clearWorkspaceDerivedState: () => void;
  restoreWorkspaceRoute: (roomId: string) => void;
  loadProjectData: (roomId: string) => Promise<boolean>;
  setLoading: (value: boolean) => void;
  setErrorMsg: (value: string | null) => void;
}

export function useWorkspaceLifecycle({
  clearWorkspaceDerivedState,
  restoreWorkspaceRoute,
  loadProjectData,
  setLoading,
  setErrorMsg
}: UseWorkspaceLifecycleOptions) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [initializingRoom, setInitializingRoom] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const result = await api.initializePersonalRoom();
        if (!active) return;
        if (!result.success || !result.room) {
          setErrorMsg(result.error || 'Failed to initialize Personal Room.');
          return;
        }
        setRoom(result.room);
        restoreWorkspaceRoute(result.room.id);
        await loadProjectData(result.room.id);
      } catch (error) {
        if (active) {
          setErrorMsg(error instanceof Error ? error.message : 'Failed to initialize Personal Room.');
        }
      } finally {
        if (active) {
          setInitializingRoom(false);
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const activeSource = useMemo(
    () => room?.sources.find(source => source.id === room.activeSourceId) || null,
    [room]
  );

  const attachSource = async () => {
    if (!room) return false;
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.attachRoomSource(room.id);
      if (!result.success) {
        setErrorMsg(result.error || 'Failed to attach Source.');
        return false;
      }
      if (result.room) {
        setRoom(result.room);
        await loadProjectData(room.id);
      }
      return !result.canceled;
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to attach Source.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const detachSource = async () => {
    if (!room || !activeSource) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.detachRoomSource(room.id, activeSource.id);
      if (!result.success || !result.room) {
        setErrorMsg(result.error || 'Failed to detach Source.');
        return;
      }
      setRoom(result.room);
      await loadProjectData(room.id);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to detach Source.');
    } finally {
      setLoading(false);
    }
  };

  const clearActiveSource = async () => {
    if (!room) return;
    const result = await api.setActiveRoomSource(room.id);
    if (result.success && result.room) {
      setRoom(result.room);
      clearWorkspaceDerivedState();
      await loadProjectData(room.id);
    }
  };

  return {
    room,
    roomId: room?.id || null,
    activeSource,
    activeSourceId: room?.activeSourceId,
    initializingRoom,
    projectPath: room?.id || null,
    isRoomProject: !!room,
    hasLegacyRoom: false,
    newWorkspaceName: '',
    setNewWorkspaceName: () => {},
    recentProjects: [],
    handleOpenProject: attachSource,
    handleCreateWorkspace: attachSource,
    handleSelectRecentProject: async () => false,
    handleInitProject: attachSource,
    handleCloseProjectWorkspace: clearActiveSource,
    handleDetachSource: detachSource
  };
}
