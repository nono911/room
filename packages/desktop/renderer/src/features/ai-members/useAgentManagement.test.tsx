import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
    const setSelectedDiscussionAgents = vi.fn();
    const setErrorMsg = vi.fn();

    const { result } = renderHook(() =>
      useAgentManagement({
        projectPath: '/workspace',
        projectData: { projectMd: '', archMd: '', tasks: [], decisions: [], reviews: [], documents: [], discussions: [], skills: [], agents: [] },
        activeTab: 'AI Members',
        setActiveTab,
        loadProjectData,
        setSelectedDiscussionAgents,
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

  test('renaming a legacy member still deletes the old name-backed file first', async () => {
    const loadProjectData = vi.fn().mockResolvedValue(undefined);
    const setActiveTab = vi.fn();
    const setSelectedDiscussionAgents = vi.fn();
    const setErrorMsg = vi.fn();

    const { result } = renderHook(() =>
      useAgentManagement({
        projectPath: '/workspace',
        projectData: { projectMd: '', archMd: '', tasks: [], decisions: [], reviews: [], documents: [], discussions: [], skills: [], agents: [] },
        activeTab: 'AI Members',
        setActiveTab,
        loadProjectData,
        setSelectedDiscussionAgents,
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

    expect(deleteAgent).toHaveBeenCalledWith('/workspace', 'Planner', undefined);
  });
});
