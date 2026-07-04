import { useState } from 'react';
import { api } from '../../shared/ipc/client.js';

interface UseWorkspaceLifecycleOptions {
  clearWorkspaceDerivedState: () => void;
  loadProjectData: (path: string) => Promise<void>;
  setLoading: (value: boolean) => void;
  setErrorMsg: (value: string | null) => void;
}

function loadRecentProjects(): string[] {
  try {
    const saved = localStorage.getItem('recentProjects');
    if (saved) {
      return JSON.parse(saved);
    }
    return [];
  } catch {
    return [];
  }
}

export function useWorkspaceLifecycle({
  clearWorkspaceDerivedState,
  loadProjectData,
  setLoading,
  setErrorMsg
}: UseWorkspaceLifecycleOptions) {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isRoomProject, setIsRoomProject] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>('');
  const [recentProjects, setRecentProjects] = useState<string[]>(loadRecentProjects);

  const addRecentProject = (pathStr: string) => {
    setRecentProjects(prev => {
      const filtered = prev.filter(p => p !== pathStr);
      const updated = [pathStr, ...filtered].slice(0, 5);
      localStorage.setItem('recentProjects', JSON.stringify(updated));
      return updated;
    });
  };

  const handleOpenProject = async () => {
    setErrorMsg(null);
    try {
      const result = await api.selectProjectDir();
      if (!result) return;

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(result.isRoomProject);

      addRecentProject(result.path);

      if (result.isRoomProject) {
        await loadProjectData(result.path);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to open project.');
    }
  };

  const handleCreateWorkspace = async () => {
    const workspaceName = newWorkspaceName.trim();
    if (!workspaceName) {
      setErrorMsg('Workspace name is required.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.createWorkspace(workspaceName);
      if (!result) return;
      if (!result.success || !result.path) {
        setErrorMsg(result.error || 'Failed to create workspace.');
        return;
      }

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(true);
      setNewWorkspaceName('');
      addRecentProject(result.path);
      await loadProjectData(result.path);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecentProject = async (pathStr: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.openProjectDir(pathStr);
      if (!result) {
        throw new Error('Project directory could not be accessed.');
      }

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(result.isRoomProject);

      addRecentProject(result.path);

      if (result.isRoomProject) {
        await loadProjectData(result.path);
      }
      return true;
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to open recent project. It might have been deleted or moved.');
      setRecentProjects(prev => {
        const filtered = prev.filter(p => p !== pathStr);
        localStorage.setItem('recentProjects', JSON.stringify(filtered));
        return filtered;
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleInitProject = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.roomInit(projectPath);
      if (res.success) {
        clearWorkspaceDerivedState();
        setIsRoomProject(true);
        addRecentProject(projectPath);
        setProjectPath(projectPath);
        await loadProjectData(projectPath);
      } else {
        setErrorMsg(res.error || 'Failed to initialize .room.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize project.');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseProjectWorkspace = () => {
    setProjectPath(null);
    setIsRoomProject(false);
    clearWorkspaceDerivedState();
  };

  return {
    projectPath,
    isRoomProject,
    newWorkspaceName,
    setNewWorkspaceName,
    recentProjects,
    handleOpenProject,
    handleCreateWorkspace,
    handleSelectRecentProject,
    handleInitProject,
    handleCloseProjectWorkspace
  };
}
