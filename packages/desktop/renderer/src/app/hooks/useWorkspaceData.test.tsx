import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceData } from './useWorkspaceData.js';

describe('useWorkspaceData', () => {
  it('returns true only when workspace core project data loads', async () => {
    const mockApi = window.electronAPI as any;
    const setProjectData = vi.fn();
    const setHasCompletedScan = vi.fn();
    const setTaskBoardCards = vi.fn();
    const selectDefaultDiscussionAgents = vi.fn();
    const setCodingTaskDeveloperName = vi.fn();
    const setCodingTaskReviewerNames = vi.fn();
    const setErrorMsg = vi.fn();

    const { result } = renderHook(() => useWorkspaceData({
      setProjectData,
      setHasCompletedScan,
      setTaskBoardCards,
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
    mockApi.loadTaskBoard.mockResolvedValue({ success: true, cards: [] });

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

  it('ignores an older metadata response after a newer reload starts', async () => {
    const mockApi = window.electronAPI as any;
    let resolveFirst: ((value: any) => void) | undefined;
    mockApi.getProjectData
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({
        success: true,
        room: { id: 'room_personal', name: 'Current', sources: [] },
        projectMd: '# Current',
        agents: []
      });
    mockApi.loadTaskBoard.mockResolvedValue({ success: true, cards: [] });
    const setProjectData = vi.fn();
    const { result } = renderHook(() => useWorkspaceData({
      setProjectData,
      setHasCompletedScan: vi.fn(),
      setTaskBoardCards: vi.fn(),
      selectDefaultDiscussionAgents: vi.fn(),
      setCodingTaskDeveloperName: vi.fn(),
      setCodingTaskReviewerNames: vi.fn(),
      setErrorMsg: vi.fn()
    }));

    let first: Promise<boolean>;
    let second: Promise<boolean>;
    act(() => {
      first = result.current.loadProjectData('room_personal');
      second = result.current.loadProjectData('room_personal');
    });
    await act(async () => {
      await second!;
      resolveFirst?.({
        success: true,
        room: { id: 'room_personal', name: 'Stale', sources: [] },
        projectMd: '# Stale',
        agents: []
      });
      await first!;
    });

    expect(setProjectData).toHaveBeenCalledTimes(1);
    expect(setProjectData).toHaveBeenCalledWith(expect.objectContaining({
      projectMd: '# Current'
    }));
  });
});
