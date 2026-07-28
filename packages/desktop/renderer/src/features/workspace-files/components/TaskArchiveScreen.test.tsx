import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskArchiveScreen } from './TaskArchiveScreen.js';

describe('TaskArchiveScreen pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads subsequent task-run summary pages from the server cursor', async () => {
    const mockApi = window.electronAPI as any;
    mockApi.listRoomTaskRuns.mockResolvedValue({
      success: true,
      taskRuns: [{
        filename: 'task-run-0001.md',
        id: 'task-run-0001',
        title: 'Older run',
        status: 'approved',
        cycles: 1
      }],
      hasMore: false,
      truncated: false
    });
    render(
      <TaskArchiveScreen
        projectPath="room_personal"
        projectData={{
          projectMd: '',
          archMd: '',
          tasks: [],
          taskRuns: [{
            filename: 'task-run-0002.md',
            id: 'task-run-0002',
            title: 'Newer run',
            status: 'approved',
            cycles: 1
          }],
          taskRunPagination: {
            hasMore: true,
            nextCursor: 'opaque-task-cursor',
            truncated: false
          },
          decisions: [],
          reviews: [],
          documents: [],
          discussions: [],
          skills: [],
          agents: []
        }}
        taskBoardCards={[]}
        initialSelectedFile={null}
        setInitialSelectedFile={vi.fn()}
        setErrorMsg={vi.fn()}
        setActiveTab={vi.fn()}
        setCodingTaskInput={vi.fn()}
        setSelectedTaskCardId={vi.fn()}
        setSelectedCodingTaskContextRefs={vi.fn()}
        setContinuedFromTaskId={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load more runs' }));
    await waitFor(() => expect(screen.getByText('Older run')).toBeDefined());
    expect(mockApi.listRoomTaskRuns).toHaveBeenCalledWith(
      'room_personal',
      'opaque-task-cursor'
    );
    expect(screen.queryByRole('button', { name: 'Load more runs' })).toBeNull();
  });
});
