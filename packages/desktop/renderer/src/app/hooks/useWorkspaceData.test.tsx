import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceData } from './useWorkspaceData.js';

describe('useWorkspaceData', () => {
  it('returns true only when workspace core project data loads', async () => {
    const mockApi = window.electronAPI as any;
    const setProjectData = vi.fn();
    const setHasCompletedScan = vi.fn();
    const loadProjectConfig = vi.fn().mockResolvedValue(undefined);
    const loadTaskBoardCards = vi.fn().mockResolvedValue(undefined);
    const selectDefaultDiscussionAgents = vi.fn();
    const setCodingTaskDeveloperName = vi.fn();
    const setCodingTaskReviewerNames = vi.fn();
    const setErrorMsg = vi.fn();

    const { result } = renderHook(() => useWorkspaceData({
      setProjectData,
      setHasCompletedScan,
      loadProjectConfig,
      loadTaskBoardCards,
      selectDefaultDiscussionAgents,
      setCodingTaskDeveloperName,
      setCodingTaskReviewerNames,
      setErrorMsg
    }));

    mockApi.getProjectData.mockResolvedValueOnce({
      success: true,
      projectMd: '# Project',
      archMd: '',
      hasScanData: false,
      tasks: [],
      taskRuns: [],
      decisions: [],
      reviews: [],
      documents: [],
      discussions: [],
      skills: [],
      agents: [],
      teams: [],
      unassignedMemberIds: []
    });

    let success = false;
    await act(async () => {
      success = await result.current.loadProjectData('/mock/project');
    });

    expect(success).toBe(true);

    mockApi.getProjectData.mockResolvedValueOnce({
      success: false,
      error: 'Failed to load metadata.'
    });

    await act(async () => {
      success = await result.current.loadProjectData('/mock/project');
    });

    expect(success).toBe(false);
    expect(setErrorMsg).toHaveBeenCalledWith('Failed to load metadata.');
  });
});
