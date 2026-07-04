import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../types/domain.js';
import { useDiscussionSelection } from './useDiscussionSelection.js';

describe('useDiscussionSelection', () => {
  it('holds pending name selections until saved members reload', async () => {
    const baseProjectData: Omit<ProjectData, 'agents'> = {
      projectMd: '',
      archMd: '',
      tasks: [],
      decisions: [],
      reviews: [],
      documents: [],
      discussions: [],
      skills: []
    };
    const initialProps: { projectData: ProjectData } = {
      projectData: {
        ...baseProjectData,
        agents: [] as ProjectData['agents']
      }
    };
    const { result, rerender } = renderHook(
      ({ projectData }: { projectData: ProjectData }) => useDiscussionSelection({ projectData }),
      {
        initialProps
      }
    );

    act(() => {
      result.current.queueDiscussionAgentSelectionByNames(['Planner', 'Reviewer']);
    });

    expect(result.current.selectedDiscussionAgents).toEqual([]);
    expect(result.current.selectedDiscussionMemberIds).toEqual([]);

    rerender({
      projectData: {
        ...baseProjectData,
        agents: [
          { id: 'mem_planner', name: 'Planner', role: 'Planning' },
          { id: 'mem_reviewer', name: 'Reviewer', role: 'QA' }
        ]
      }
    });

    await waitFor(() => {
      expect(result.current.selectedDiscussionMemberIds).toEqual(['mem_planner', 'mem_reviewer']);
    });

    expect(result.current.selectedDiscussionAgents).toEqual(['Planner', 'Reviewer']);
  });

  it('does not replace queued preset names with default saved agents during reload', async () => {
    const baseProjectData: Omit<ProjectData, 'agents'> = {
      projectMd: '',
      archMd: '',
      tasks: [],
      decisions: [],
      reviews: [],
      documents: [],
      discussions: [],
      skills: []
    };
    const loadedAgents: ProjectData['agents'] = [
      { id: 'mem_default', name: 'Default', role: 'Generalist' },
      { id: 'mem_planner', name: 'Planner', role: 'Planning' },
      { id: 'mem_reviewer', name: 'Reviewer', role: 'QA' }
    ];
    const { result, rerender } = renderHook(
      ({ projectData }: { projectData: ProjectData }) => useDiscussionSelection({ projectData }),
      {
        initialProps: {
          projectData: {
            ...baseProjectData,
            agents: [] as ProjectData['agents']
          }
        }
      }
    );

    act(() => {
      result.current.queueDiscussionAgentSelectionByNames(['Planner', 'Reviewer']);
    });

    act(() => {
      result.current.selectDefaultDiscussionAgents(loadedAgents);
    });

    expect(result.current.selectedDiscussionMemberIds).toEqual([]);
    expect(result.current.selectedDiscussionAgents).toEqual([]);

    rerender({
      projectData: {
        ...baseProjectData,
        agents: loadedAgents
      }
    });

    await waitFor(() => {
      expect(result.current.selectedDiscussionMemberIds).toEqual(['mem_planner', 'mem_reviewer']);
    });

    expect(result.current.selectedDiscussionAgents).toEqual(['Planner', 'Reviewer']);
  });

  it('dedupes saved and temporary ids at write time', () => {
    const { result } = renderHook(() => useDiscussionSelection({
      projectData: {
        projectMd: '',
        archMd: '',
        tasks: [],
        decisions: [],
        reviews: [],
        documents: [],
        discussions: [],
        skills: [],
        agents: [
          { id: 'mem_planner', name: 'Planner', role: 'Planning' },
          { id: 'mem_reviewer', name: 'Reviewer', role: 'QA' }
        ]
      }
    }));

    act(() => {
      result.current.appendSelectedDiscussionMemberIds(['mem_planner', 'mem_planner', 'mem_reviewer']);
    });

    expect(result.current.selectedDiscussionMemberIds).toEqual(['mem_planner', 'mem_reviewer']);

    act(() => {
      result.current.setTemporaryDiscussionAgents([
        { id: 'tmp_1', name: 'Clone 1', role: 'Review', provider: 'gemini', systemPrompt: 'Prompt' },
        { id: 'tmp_1', name: 'Clone 1 duplicate', role: 'Review', provider: 'gemini', systemPrompt: 'Prompt' },
        { id: 'tmp_2', name: 'Clone 2', role: 'Review', provider: 'gemini', systemPrompt: 'Prompt' }
      ]);
      result.current.appendSelectedTemporaryDiscussionAgentIds(['tmp_1', 'tmp_1', 'tmp_2']);
    });

    expect(result.current.temporaryDiscussionAgents.map((agent) => agent.id)).toEqual(['tmp_1', 'tmp_2']);
    expect(result.current.selectedTemporaryDiscussionAgentIds).toEqual(['tmp_1', 'tmp_2']);
  });

  it('preserves temporary-first execution order when saved members are selected afterward', () => {
    const { result } = renderHook(() => useDiscussionSelection({
      projectData: {
        projectMd: '',
        archMd: '',
        tasks: [],
        decisions: [],
        reviews: [],
        documents: [],
        discussions: [],
        skills: [],
        agents: [
          { id: 'mem_planner', name: 'Planner', role: 'Planning' },
          { id: 'mem_reviewer', name: 'Reviewer', role: 'QA' }
        ]
      }
    }));

    act(() => {
      result.current.setTemporaryDiscussionAgents([
        { id: 'tmp_red', name: 'Red Team', role: 'Review', provider: 'gemini', systemPrompt: 'Prompt' }
      ]);
      result.current.appendSelectedTemporaryDiscussionAgentIds(['tmp_red']);
      result.current.appendSelectedDiscussionMemberIds(['mem_planner', 'mem_reviewer']);
    });

    expect(result.current.selectedTemporaryDiscussionAgentIds).toEqual(['tmp_red']);
    expect(result.current.selectedDiscussionMemberIds).toEqual(['mem_planner', 'mem_reviewer']);
    expect(result.current.selectedDiscussionAgents).toEqual(['Red Team', 'Planner', 'Reviewer']);
  });
});
