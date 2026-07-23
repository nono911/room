import type { ProjectData } from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';

interface UseWorkspaceDataOptions {
  setProjectData: (value: ProjectData | null) => void;
  setHasCompletedScan: (value: boolean) => void;
  loadProjectConfig: (path: string) => Promise<void>;
  loadTaskBoardCards: (path: string) => Promise<void>;
  selectDefaultDiscussionAgents: (agents: any[]) => void;
  setCodingTaskDeveloperName: (value: string | ((prev: string) => string)) => void;
  setCodingTaskReviewerNames: (value: string[] | ((prev: string[]) => string[])) => void;
  setErrorMsg: (value: string | null) => void;
}

export function useWorkspaceData({
  setProjectData,
  setHasCompletedScan,
  loadProjectConfig,
  loadTaskBoardCards,
  selectDefaultDiscussionAgents,
  setCodingTaskDeveloperName,
  setCodingTaskReviewerNames,
  setErrorMsg
}: UseWorkspaceDataOptions) {
  const loadWorkspaceCoreData = async (pathStr: string) => {
    const data = await api.getProjectData(pathStr);
    if (data.success) {
      setHasCompletedScan(!!localStorage.getItem(`room_scan_completed:${pathStr}`) || !!data.hasScanData);
      setProjectData({
        projectMd: data.projectMd,
        archMd: data.archMd,
        hasScanData: data.hasScanData,
        tasks: data.tasks,
        taskRuns: data.taskRuns || [],
        decisions: data.decisions,
        reviews: data.reviews || [],
        documents: data.documents || [],
        discussions: data.discussions,
        skills: data.skills,
        machineSkills: data.machineSkills || [],
        agents: data.agents || [],
        teams: data.teams || [],
        unassignedMemberIds: data.unassignedMemberIds || []
      });
      return data;
    }

    setErrorMsg(data.error || 'Failed to load project metadata.');
    return null;
  };

  const selectDefaultAgents = (agents: any[]) => {
    selectDefaultDiscussionAgents(agents);
    if (agents && agents.length > 0) {
      const names = agents.map((agent: any) => agent.name);
      const developerCandidate = agents.find((agent: any) => {
        const text = `${agent.name} ${agent.role}`.toLowerCase();
        return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('coder');
      }) || agents[0];
      setCodingTaskDeveloperName(prev => names.includes(prev) ? prev : developerCandidate?.name || '');
      setCodingTaskReviewerNames(prev => {
        const validPrev = prev.filter(name => names.includes(name));
        if (validPrev.length > 0) return validPrev;
        return agents
          .filter((agent: any) => {
            const text = `${agent.name} ${agent.role}`.toLowerCase();
            return text.includes('review') || text.includes('senior') || text.includes('qa');
          })
          .map((agent: any) => agent.name)
          .slice(0, 2);
      });
    } else {
      setCodingTaskDeveloperName('');
      setCodingTaskReviewerNames([]);
    }
  };

  const loadProjectData = async (pathStr: string): Promise<boolean> => {
    try {
      const data = await loadWorkspaceCoreData(pathStr);
      if (!data) {
        return false;
      }

      selectDefaultAgents(data.agents || []);
      await loadProjectConfig(pathStr);
      await loadTaskBoardCards(pathStr);
      return true;
    } catch (err: any) {
      setErrorMsg(err.message || 'Error fetching project data.');
      return false;
    }
  };

  return {
    loadWorkspaceCoreData,
    loadProjectData
  };
}
