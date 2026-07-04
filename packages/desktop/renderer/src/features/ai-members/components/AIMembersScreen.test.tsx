import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AIMembersScreen } from './AIMembersScreen.js';

vi.mock('../../../features/providers/context/ProvidersContext.js', () => ({
  useProviders: () => ({
    detectedClis: [],
    scanClis: vi.fn()
  })
}));

describe('AIMembersScreen', () => {
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
});
