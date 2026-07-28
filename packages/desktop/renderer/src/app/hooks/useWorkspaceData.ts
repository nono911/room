import { useRef } from 'react';
import type { ProjectData } from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';
import { taskParticipantEntries } from '../../features/task-run/taskParticipantRefs.js';

interface UseWorkspaceDataOptions {
  setProjectData: (value: ProjectData | null) => void;
  setHasCompletedScan: (value: boolean) => void;
  setTaskBoardCards: (cards: any[]) => void;
  selectDefaultDiscussionAgents: (agents: any[]) => void;
  setCodingTaskDeveloperName: (value: string | ((prev: string) => string)) => void;
  setCodingTaskReviewerNames: (value: string[] | ((prev: string[]) => string[])) => void;
  setErrorMsg: (value: string | null) => void;
}

export function useWorkspaceData({
  setProjectData,
  setHasCompletedScan,
  setTaskBoardCards,
  selectDefaultDiscussionAgents,
  setCodingTaskDeveloperName,
  setCodingTaskReviewerNames,
  setErrorMsg
}: UseWorkspaceDataOptions) {
  const loadGeneration = useRef(0);
  const fetchWorkspaceCoreData = async (pathStr: string, generation: number) => {
    const data = await api.getProjectData(pathStr);
    if (generation !== loadGeneration.current) return null;
    if (data.success) {
      setHasCompletedScan(!!localStorage.getItem(`room_scan_completed:${pathStr}`) || !!data.hasScanData);
      setProjectData({
        room: data.room,
        projectMd: data.projectMd || '',
        archMd: data.archMd || '',
        hasScanData: data.hasScanData,
        tasks: data.tasks || [],
        taskRuns: data.taskRuns || [],
        decisions: data.decisions || [],
        reviews: data.reviews || [],
        documents: data.documents || [],
        discussions: data.discussions || [],
        skills: data.skills || [],
        machineSkills: data.machineSkills || [],
        machineSkillsTruncated: Boolean(data.machineSkillsTruncated),
        agents: data.agents || [],
        teams: data.teams || [],
        unassignedMemberIds: data.unassignedMemberIds || [],
        artifactListPagination: data.artifactListPagination || {},
        taskRunPagination: data.taskRunPagination
      });
      return data;
    }

    setErrorMsg(data.error || 'Failed to load Room metadata.');
    return null;
  };

  const loadWorkspaceCoreData = async (pathStr: string) => {
    const generation = ++loadGeneration.current;
    return fetchWorkspaceCoreData(pathStr, generation);
  };

  const selectDefaultAgents = (agents: any[]) => {
    selectDefaultDiscussionAgents(agents);
    if (agents && agents.length > 0) {
      const entries = taskParticipantEntries(agents, []);
      const references = entries.map(entry => entry.ref);
      const developerCandidate = entries.find(entry => {
        const text = `${entry.agent.name} ${entry.agent.role}`.toLowerCase();
        return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('coder');
      }) || entries[0];
      setCodingTaskDeveloperName(prev => references.includes(prev) ? prev : developerCandidate?.ref || '');
      setCodingTaskReviewerNames(prev => {
        const validPrev = prev.filter(reference => references.includes(reference));
        if (validPrev.length > 0) return validPrev;
        return entries
          .filter(entry => {
            const text = `${entry.agent.name} ${entry.agent.role}`.toLowerCase();
            return text.includes('review') || text.includes('senior') || text.includes('qa');
          })
          .map(entry => entry.ref)
          .slice(0, 2);
      });
    } else {
      setCodingTaskDeveloperName('');
      setCodingTaskReviewerNames([]);
    }
  };

  const loadProjectData = async (pathStr: string): Promise<boolean> => {
    const generation = ++loadGeneration.current;
    try {
      const data = await fetchWorkspaceCoreData(pathStr, generation);
      if (!data) {
        return false;
      }

      if (generation !== loadGeneration.current) return false;
      selectDefaultAgents(data.agents || []);
      const board = await api.loadTaskBoard(pathStr);
      if (generation !== loadGeneration.current) return false;
      if (board.success && board.cards) {
        setTaskBoardCards(board.cards);
      } else if (!board.success && board.error) {
        setErrorMsg(`Failed to load Task Board: ${board.error}`);
      }
      return true;
    } catch (err: any) {
      if (generation !== loadGeneration.current) return false;
      setErrorMsg(err.message || 'Error fetching Room data.');
      return false;
    }
  };

  return {
    loadWorkspaceCoreData,
    loadProjectData
  };
}
