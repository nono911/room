import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMembersScreen } from './AIMembersScreen.js';

const { createTeamWithMembers } = vi.hoisted(() => ({
  createTeamWithMembers: vi.fn()
}));

vi.mock('../../../features/providers/context/ProvidersContext.js', () => ({
  useProviders: () => ({
    detectedClis: [],
    scanClis: vi.fn()
  })
}));

vi.mock('../../../shared/ipc/client.js', () => ({
  api: {
    createTeamWithMembers
  }
}));

vi.mock('./CreateTeamWizard.js', () => ({
  CreateTeamWizard: (props: {
    onCreate: (
      team: { name: string; description?: string },
      members: unknown[],
      skillDrafts: Array<{ name: string; content: string }>
    ) => Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          void props.onCreate(
            { name: 'Product' },
            [{ name: 'Planner', role: 'Planning', provider: 'gemini', systemPrompt: 'Prompt', skills: [] }],
            []
          );
        }}
      >
        Submit team wizard
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel team wizard
      </button>
    </div>
  )
}));

describe('AIMembersScreen', () => {
  beforeEach(() => {
    createTeamWithMembers.mockReset();
  });

  it('shows recommended teams exclusively when no saved teams exist', () => {
    render(
      <AIMembersScreen
        projectPath="/workspace"
        projectData={{
          projectMd: '',
          archMd: '',
          tasks: [],
          decisions: [],
          reviews: [],
          documents: [],
          discussions: [],
          skills: [],
          agents: [{ id: 'mem_a_123', name: 'Saved Agent', role: 'Developer' }],
          teams: [],
          unassignedMemberIds: ['mem_a_123']
        }}
        aiMemberDetailsExpanded={false}
        setAiMemberDetailsExpanded={vi.fn()}
        resetAgentForm={vi.fn()}
        setActiveTab={vi.fn()}
        teamPresets={[
          { name: 'Recommended Team', description: 'Preset', roles: ['Developer', 'Reviewer'] }
        ]}
        loadProjectData={vi.fn().mockResolvedValue(undefined)}
        startEditAgent={vi.fn()}
        handleDeleteAgent={vi.fn()}
      />
    );

    expect(screen.getByText('Recommended Teams')).toBeTruthy();
    expect(screen.queryByText('Teams')).toBeNull();
    expect(screen.queryByText('Unassigned')).toBeNull();
  });

  it('surfaces rollback warning cleanup paths when team creation fails', async () => {
    createTeamWithMembers.mockResolvedValue({
      success: false,
      error: 'Failed to create team.',
      rollbackWarnings: ['/tmp/room-cleanup/member.json']
    });

    render(
      <AIMembersScreen
        projectPath="/workspace"
        projectData={{
          projectMd: '',
          archMd: '',
          tasks: [],
          decisions: [],
          reviews: [],
          documents: [],
          discussions: [],
          skills: [],
          agents: [],
          teams: [],
          unassignedMemberIds: []
        }}
        aiMemberDetailsExpanded={false}
        setAiMemberDetailsExpanded={vi.fn()}
        resetAgentForm={vi.fn()}
        setActiveTab={vi.fn()}
        teamPresets={[]}
        loadProjectData={vi.fn().mockResolvedValue(undefined)}
        startEditAgent={vi.fn()}
        handleDeleteAgent={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Team' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit team wizard' }));

    await waitFor(() => {
      expect(screen.getByText(/\/tmp\/room-cleanup\/member\.json/)).toBeTruthy();
    });
  });
});
