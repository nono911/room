import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityScreen } from './ActivityScreen.js';

const projectData = {
  projectMd: '',
  archMd: '',
  tasks: [],
  taskRuns: [],
  decisions: [],
  reviews: [],
  documents: [],
  discussions: [],
  skills: [],
  agents: []
};

describe('ActivityScreen', () => {
  it('hydrates the previous task and mode before opening Run again', () => {
    const setActiveTab = vi.fn();
    const setCodingTaskInput = vi.fn();
    const applyTaskTypePreset = vi.fn();

    render(
      <ActivityScreen
        projectData={projectData}
        activeDiscussionRunId={null}
        activeTaskRunId={null}
        lastCodingTaskResult={{
          id: 'task-123',
          title: 'Task result',
          task: 'Refine the file browser',
          taskType: 'coding',
          status: 'approved',
          cycles: 2
        }}
        setActiveTab={setActiveTab}
        setCodingTaskInput={setCodingTaskInput}
        applyTaskTypePreset={applyTaskTypePreset}
        setInitialSelectedFile={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(setCodingTaskInput).toHaveBeenCalledWith('Refine the file browser');
    expect(applyTaskTypePreset).toHaveBeenCalledWith('coding');
    expect(setActiveTab).toHaveBeenCalledWith('Run:Execute');
  });
});
