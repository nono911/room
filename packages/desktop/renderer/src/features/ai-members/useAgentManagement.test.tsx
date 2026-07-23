import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProjectData } from '../../types/domain.js';

const {
  saveAgent,
  deleteAgent,
  previewAgentSkills,
  saveSkill,
  fetchModelsForProvider
} = vi.hoisted(() => ({
  saveAgent: vi.fn(),
  deleteAgent: vi.fn(),
  previewAgentSkills: vi.fn(),
  saveSkill: vi.fn(),
  fetchModelsForProvider: vi.fn()
}));

vi.mock('../../shared/ipc/client.js', () => ({
  api: {
    saveAgent,
    deleteAgent,
    previewAgentSkills,
    saveSkill
  }
}));

vi.mock('../providers/context/ProvidersContext.js', () => ({
  useProviders: () => ({
    providers: [],
    detectedClis: [],
    dynamicCliModels: {},
    getModelOptions: () => [{ value: 'gemini-1.5-flash' }],
    fetchModelsForProvider
  })
}));

import { useAgentManagement } from './useAgentManagement.js';

describe('useAgentManagement save flow', () => {
  beforeEach(() => {
    saveAgent.mockReset();
    deleteAgent.mockReset();
    previewAgentSkills.mockReset();
    saveSkill.mockReset();
    saveAgent.mockResolvedValue({ success: true });
    deleteAgent.mockResolvedValue({ success: true });
  });

  test('renaming an id-backed member saves in place without deleting team refs', async () => {
    const loadProjectData = vi.fn().mockResolvedValue(undefined);
    const setActiveTab = vi.fn();
    const setErrorMsg = vi.fn();

    const { result } = renderHook(() =>
      useAgentManagement({
        projectPath: '/workspace',
        projectData: { projectMd: '', archMd: '', tasks: [], decisions: [], reviews: [], documents: [], discussions: [], skills: [], agents: [] },
        activeTab: 'AI Members',
        setActiveTab,
        loadProjectData,
        setErrorMsg
      })
    );

    act(() => {
      result.current.startEditAgent({
        id: 'mem_planner',
        name: 'Planner',
        role: 'Assistant',
        provider: 'gemini',
        modelName: 'gemini-1.5-flash',
        systemPrompt: 'Prompt',
        skills: []
      });
    });

    act(() => {
      result.current.setNewAgentName('Lead Planner');
    });

    await act(async () => {
      await result.current.handleSaveAgent({ preventDefault() {} } as React.FormEvent);
    });

    expect(deleteAgent).not.toHaveBeenCalled();
    expect(saveAgent).toHaveBeenCalledWith('/workspace', expect.objectContaining({
      id: 'mem_planner',
      name: 'Lead Planner'
    }));
  });

  test('renaming a legacy member routes the previous name through save-agent for main-process cleanup', async () => {
    const loadProjectData = vi.fn().mockResolvedValue(undefined);
    const setActiveTab = vi.fn();
    const setErrorMsg = vi.fn();

    const { result } = renderHook(() =>
      useAgentManagement({
        projectPath: '/workspace',
        projectData: { projectMd: '', archMd: '', tasks: [], decisions: [], reviews: [], documents: [], discussions: [], skills: [], agents: [] },
        activeTab: 'AI Members',
        setActiveTab,
        loadProjectData,
        setErrorMsg
      })
    );

    act(() => {
      result.current.startEditAgent({
        name: 'Planner',
        role: 'Assistant',
        provider: 'gemini',
        modelName: 'gemini-1.5-flash',
        systemPrompt: 'Prompt',
        skills: []
      });
    });

    act(() => {
      result.current.setNewAgentName('Lead Planner');
    });

    await act(async () => {
      await result.current.handleSaveAgent({ preventDefault() {} } as React.FormEvent);
    });

    expect(deleteAgent).not.toHaveBeenCalled();
    expect(saveAgent).toHaveBeenCalledWith('/workspace', expect.objectContaining({
      previousName: 'Planner',
      name: 'Lead Planner'
    }));
  });

  test('hydrates the editor from project data when landing on an id-backed agent route', async () => {
    const { result } = renderHook(() =>
      useAgentManagement({
        projectPath: '/workspace',
        projectData: {
          projectMd: '',
          archMd: '',
          tasks: [],
          decisions: [],
          reviews: [],
          documents: [],
          discussions: [],
          skills: [],
          agents: [{
            id: 'mem_planner',
            name: 'Planner',
            role: 'Assistant',
            provider: 'gemini',
            modelName: 'gemini-1.5-flash',
            systemPrompt: 'Prompt',
            skills: ['planning.md']
          }]
        },
        activeTab: 'Agent:mem_planner',
        setActiveTab: vi.fn(),
        loadProjectData: vi.fn().mockResolvedValue(undefined),
        setErrorMsg: vi.fn()
      })
    );

    await waitFor(() => {
      expect(result.current.editingAgent?.id).toBe('mem_planner');
    });

    expect(result.current.newAgentName).toBe('Planner');
    expect(result.current.newAgentRole).toBe('Assistant');
    expect(result.current.newAgentPrompt).toBe('Prompt');
    expect(result.current.newAgentSkills).toEqual(['planning.md']);
  });

  test('clears stale editor state and rejects a missing agent route after switching workspaces', async () => {
    const setActiveTab = vi.fn();
    const loadProjectData = vi.fn().mockResolvedValue(undefined);
    const setErrorMsg = vi.fn();
    const workspaceA: ProjectData = {
      projectMd: '',
      archMd: '',
      tasks: [],
      decisions: [],
      reviews: [],
      documents: [],
      discussions: [],
      skills: [],
      agents: [{
        id: 'mem_a',
        name: 'Workspace A Agent',
        role: 'Assistant',
        provider: 'gemini',
        modelName: 'gemini-1.5-flash',
        systemPrompt: 'Workspace A prompt',
        skills: ['a.md']
      }]
    };
    const workspaceB: ProjectData = {
      ...workspaceA,
      agents: []
    };
    const { result, rerender } = renderHook(
      ({ projectPath, projectData }) => useAgentManagement({
        projectPath,
        projectData,
        activeTab: 'Agent:mem_a',
        setActiveTab,
        loadProjectData,
        setErrorMsg
      }),
      {
        initialProps: {
          projectPath: '/workspace/a',
          projectData: workspaceA as ProjectData | null
        }
      }
    );

    await waitFor(() => expect(result.current.editingAgent?.id).toBe('mem_a'));

    rerender({
      projectPath: '/workspace/b',
      projectData: null
    });
    await waitFor(() => {
      expect(result.current.editingAgent).toBeNull();
      expect(result.current.newAgentName).toBe('');
    });

    rerender({
      projectPath: '/workspace/b',
      projectData: workspaceB
    });
    await waitFor(() => expect(setActiveTab).toHaveBeenCalledWith('AI Members'));

    act(() => {
      result.current.setNewAgentName('Workspace B Agent');
    });
    await act(async () => {
      await result.current.handleSaveAgent({ preventDefault() {} } as React.FormEvent);
    });

    expect(saveAgent).toHaveBeenLastCalledWith(
      '/workspace/b',
      expect.objectContaining({
        id: undefined,
        previousName: undefined,
        name: 'Workspace B Agent'
      })
    );
    expect(setErrorMsg).toHaveBeenLastCalledWith(null);
  });
});
