import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamDetailScreen } from './TeamDetailScreen.js';

const createTeamWizardMock = vi.fn();

vi.mock('./CreateTeamWizard.js', () => ({
  CreateTeamWizard: (props: {
    onCreate: (
      team: { name: string; description?: string },
      members: unknown[],
      skillDrafts: Array<{ name: string; content: string }>
    ) => Promise<void>;
    onCancel: () => void;
  }) => {
    createTeamWizardMock(props);
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            void props.onCreate(
              { name: 'Product' },
              [{ name: 'QA Analyst', role: 'QA', provider: 'gemini', systemPrompt: 'Prompt' }],
              [{ name: 'test-strategy.md', content: '# Test Strategy' }]
            );
          }}
        >
          Submit template members
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel template members
        </button>
      </div>
    );
  }
}));

describe('TeamDetailScreen', () => {
  beforeEach(() => {
    createTeamWizardMock.mockReset();
  });

  it('reorders, appends, routes edits by id, and adds generated members via addMembersToTeam', async () => {
    const updateTeamMembers = vi.fn().mockResolvedValue(undefined);
    const addMembersToTeam = vi.fn().mockResolvedValue(undefined);
    const reloadProjectData = vi.fn().mockResolvedValue(undefined);
    const setActiveTab = vi.fn();
    const startEditAgent = vi.fn();

    render(
      <TeamDetailScreen
        projectPath="/tmp/workspace"
        team={{
          id: 'team_product_123',
          name: 'Product',
          description: 'Product team',
          memberIds: ['mem_a_123', 'mem_b_123'],
          members: [
            { id: 'mem_a_123', name: 'Analyst', role: 'Research' },
            { id: 'mem_b_123', name: 'Designer', role: 'UX' }
          ]
        }}
        availableMembers={[
          { id: 'mem_c_123', name: 'Engineer', role: 'Developer' },
          { id: 'mem_a_123', name: 'Analyst', role: 'Research' }
        ]}
        existingNames={['Analyst', 'Designer', 'Engineer']}
        existingSkillFiles={['existing-skill.md']}
        api={{
          updateTeamMembers,
          addMembersToTeam
        }}
        reloadProjectData={reloadProjectData}
        setActiveTab={setActiveTab}
        startEditAgent={startEditAgent}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Designer up' }));
    await waitFor(() =>
      expect(updateTeamMembers).toHaveBeenCalledWith('/tmp/workspace', 'team_product_123', ['mem_b_123', 'mem_a_123'])
    );

    fireEvent.change(screen.getByLabelText('Add existing member'), {
      target: { value: 'mem_c_123' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add existing member to team' }));
    await waitFor(() =>
      expect(updateTeamMembers).toHaveBeenCalledWith('/tmp/workspace', 'team_product_123', ['mem_a_123', 'mem_b_123', 'mem_c_123'])
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Analyst' }));
    expect(startEditAgent).toHaveBeenCalledWith({ id: 'mem_a_123', name: 'Analyst', role: 'Research' });
    expect(setActiveTab).toHaveBeenCalledWith('Agent:mem_a_123');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Designer' }));
    await waitFor(() =>
      expect(updateTeamMembers).toHaveBeenCalledWith('/tmp/workspace', 'team_product_123', ['mem_a_123'])
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add template members' }));
    expect(createTeamWizardMock).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Submit template members' }));
    await waitFor(() =>
      expect(addMembersToTeam).toHaveBeenCalledWith(
        '/tmp/workspace',
        'team_product_123',
        [{ name: 'QA Analyst', role: 'QA', provider: 'gemini', systemPrompt: 'Prompt' }],
        [{ name: 'test-strategy.md', content: '# Test Strategy' }]
      )
    );
    expect(reloadProjectData).toHaveBeenCalled();
  });
});
