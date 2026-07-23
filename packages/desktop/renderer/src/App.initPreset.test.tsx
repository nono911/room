import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import App from './app/App.js';
import { ProvidersProvider } from './features/providers/context/ProvidersContext.js';

const loadedProjectData = {
  success: true,
  projectMd: '# Mock Project',
  archMd: '',
  hasScanData: false,
  tasks: [],
  taskRuns: [],
  decisions: [],
  reviews: [],
  documents: [],
  discussions: [],
  skills: [],
  agents: [
    { id: 'mem_default_alpha', name: 'Default Alpha', role: 'Generalist', provider: 'Gemini' },
    { id: 'mem_default_beta', name: 'Default Beta', role: 'Generalist', provider: 'Gemini' },
    { id: 'mem_developer', name: 'Developer', role: 'Developer', provider: 'Gemini' },
    { id: 'mem_reviewer', name: 'Reviewer', role: 'Reviewer', provider: 'Gemini' },
    { id: 'mem_qa', name: 'QA', role: 'QA', provider: 'Gemini' }
  ],
  teams: [],
  unassignedMemberIds: [
    'mem_default_alpha',
    'mem_default_beta',
    'mem_developer',
    'mem_reviewer',
    'mem_qa'
  ]
};

function getSelectedParticipantTexts() {
  return Array.from(document.querySelectorAll('.skill-checkbox-chip.selected'))
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

test('workspace init preset keeps intended discussion members after reload reset', async () => {
  localStorage.clear();
  vi.clearAllMocks();

  const mockApi = window.electronAPI as any;
  mockApi.selectProjectDir.mockResolvedValue({
    success: true,
    path: '/mock/path/project-init',
    isRoomProject: false
  });
  mockApi.roomInit.mockResolvedValue({ success: true });
  mockApi.openProjectDir.mockResolvedValue({
    success: true,
    path: '/mock/path/project-init',
    isRoomProject: true
  });
  mockApi.getProjectData.mockResolvedValue(loadedProjectData);
  mockApi.saveSkill.mockResolvedValue({ success: true });
  mockApi.saveAgent.mockResolvedValue({ success: true });
  mockApi.loadProviders.mockResolvedValue({
    success: true,
    providers: [
      { id: 'gemini', label: 'Gemini', baseUrl: '', keyless: false, configurable: true }
    ]
  });
  mockApi.detectLocalAgents.mockResolvedValue({
    success: true,
    agents: []
  });
  mockApi.detectApiModels.mockResolvedValue({
    success: true,
    models: [{ value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }]
  });
  mockApi.loadProjectConfig.mockResolvedValue({
    success: true,
    config: {
      mainAgent: '',
      modelName: 'gemini-1.5-pro',
      allowDangerousCli: false
    }
  });

  render(
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  );

  fireEvent.click(screen.getByText('Open Existing Workspace'));

  await waitFor(() => {
    expect(screen.getByText('Initialize ROOM Workspace')).not.toBeNull();
  });

  fireEvent.click(screen.getByText('Coding Execution'));

  await waitFor(() => {
    expect(screen.queryByText('Initialize ROOM Workspace')).toBeNull();
  });

  const skipButton = screen.queryByText('Skip');
  if (skipButton) {
    fireEvent.click(skipButton);
  }
  fireEvent.click(screen.getByText('New Run'));

  await waitFor(() => {
    const selectedTexts = getSelectedParticipantTexts();
    expect(selectedTexts.some((text) => text.includes('Developer'))).toBe(true);
    expect(selectedTexts.some((text) => text.includes('Reviewer'))).toBe(true);
    expect(selectedTexts.some((text) => text.includes('QA'))).toBe(true);
    expect(selectedTexts.some((text) => text.includes('Default Alpha'))).toBe(false);
    expect(selectedTexts.some((text) => text.includes('Default Beta'))).toBe(false);
  });
});
