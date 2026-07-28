import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskRun } from './useTaskRun.js';

describe('useTaskRun continuation lineage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the interrupted task as the parent when continuing from a pivot', () => {
    const { result } = renderHook(() => useTaskRun({
      projectPath: 'room_personal',
      activeSourceId: 'source_11111111111111111111111111111111',
      projectData: null,
      loadProjectData: vi.fn(),
      setLoading: vi.fn(),
      setErrorMsg: vi.fn()
    }));

    act(() => {
      result.current.setLastCodingTaskResult({
        id: 'task-parent',
        task: 'Original request',
        status: 'interrupted',
        messages: [{
          type: 'user',
          content: 'Interrupt & Pivot:\n\nUse the safer design.'
        }]
      });
    });
    act(() => result.current.continueTaskRunFromPivot());

    expect(result.current.continuedFromTaskId).toBe('task-parent');
    expect(result.current.codingTaskInput).toContain('Use the safer design.');
    expect(result.current.taskRunView).toBe('setup');
  });

  it('clears lineage and task-card association when starting a new run', () => {
    const { result } = renderHook(() => useTaskRun({
      projectPath: 'room_personal',
      activeSourceId: 'source_11111111111111111111111111111111',
      projectData: null,
      loadProjectData: vi.fn(),
      setLoading: vi.fn(),
      setErrorMsg: vi.fn()
    }));

    act(() => {
      result.current.setContinuedFromTaskId('task-parent');
      result.current.setSelectedTaskCardId('card-parent');
      result.current.setCodingTaskInput('Inherited request');
      result.current.setSelectedCodingTaskContextRefs(['document:inherited.md']);
    });
    act(() => result.current.startNewTaskRun());

    expect(result.current.continuedFromTaskId).toBeNull();
    expect(result.current.selectedTaskCardId).toBeNull();
    expect(result.current.codingTaskInput).toBe('');
    expect(result.current.selectedCodingTaskContextRefs)
      .toEqual(['workspace:overview', 'workspace:structure']);
  });

  it('consumes continuation lineage after a successful run', async () => {
    vi.mocked(window.electronAPI.runTask).mockResolvedValueOnce({
      success: true,
      result: {
        id: 'task-child',
        title: 'Child task',
        task: 'Continue inherited request',
        status: 'approved',
        messages: [],
        cycles: 1,
        markdownFilename: 'task-child.md',
        jsonFilename: 'task-child.json',
        sourceProvenance: {
          mode: 'room-only',
          roomId: 'room_personal',
          startedAt: '2026-01-01T00:00:00.000Z'
        }
      }
    });
    const loadProjectData = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTaskRun({
      projectPath: 'room_personal',
      activeSourceId: 'source_11111111111111111111111111111111',
      projectData: null,
      loadProjectData,
      setLoading: vi.fn(),
      setErrorMsg: vi.fn()
    }));

    act(() => {
      result.current.setCodingTaskInput('Continue safely');
      result.current.setCodingTaskDeveloperName('member:mem_doer');
      result.current.setCodingTaskReviewerNames(['member:mem_reviewer']);
      result.current.setContinuedFromTaskId('task-parent');
      result.current.setSelectedTaskCardId('card-parent');
    });
    await act(async () => {
      await result.current.handleRunCodingTask();
    });

    expect(window.electronAPI.runTask).toHaveBeenCalledWith(
      'room_personal',
      'Continue safely',
      expect.objectContaining({
        doerRef: 'member:mem_doer',
        reviewerRefs: ['member:mem_reviewer'],
        continuedFromTaskId: 'task-parent',
        associatedCardId: 'card-parent'
      })
    );
    expect(result.current.continuedFromTaskId).toBeNull();
    expect(result.current.selectedTaskCardId).toBeNull();
    expect(loadProjectData).toHaveBeenCalledWith('room_personal');
  });
});
