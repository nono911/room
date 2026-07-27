import { render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './app/App.js';
import { ProvidersProvider } from './features/providers/context/ProvidersContext.js';

test('keeps agents and machine skills available in a source-less Room', async () => {
  localStorage.setItem('room_onboarding_seen:room_personal', 'true');
  const mockApi = window.electronAPI as any;
  mockApi.initializePersonalRoom.mockResolvedValue({
    success: true,
    room: { id: 'room_personal', name: 'Personal Room', sources: [] }
  });
  mockApi.getProjectData.mockResolvedValue({
    success: true,
    room: { id: 'room_personal', name: 'Personal Room', sources: [] },
    projectMd: '',
    archMd: '',
    tasks: [],
    decisions: [],
    reviews: [],
    documents: [],
    discussions: [],
    skills: [],
    machineSkills: [{
      reference: 'machine://codex/review',
      name: 'review',
      source: 'codex',
      sourceLabel: 'Codex',
      relativePath: 'review/SKILL.md',
      modifiedAt: '2026-01-01T00:00:00.000Z'
    }],
    agents: [{
      id: 'mem_reviewer',
      name: 'Reviewer',
      role: 'Reviewer',
      provider: 'gemini',
      skills: ['machine://codex/review']
    }],
    teams: [],
    unassignedMemberIds: ['mem_reviewer']
  });
  mockApi.loadProjectConfig.mockResolvedValue({
    success: true,
    config: { mainAgent: 'none', allowDangerousCli: false }
  });
  mockApi.loadTaskBoard.mockResolvedValue({ success: true, cards: [] });

  render(
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  );

  await waitFor(() => expect(screen.getByText('AI members')).toBeDefined());
  expect(screen.getByText('Skills available')).toBeDefined();
  expect(mockApi.getProjectData).toHaveBeenCalledWith('room_personal');
});
