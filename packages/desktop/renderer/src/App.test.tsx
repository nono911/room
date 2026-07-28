import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import App from './app/App.js';
import { ProvidersProvider } from './features/providers/context/ProvidersContext.js';

const emptyRoomData = {
  success: true,
  room: { id: 'room_personal', name: 'Personal Room', sources: [] },
  projectMd: '# Personal Room',
  archMd: '',
  hasScanData: false,
  tasks: [],
  taskRuns: [],
  decisions: [],
  reviews: [],
  documents: [],
  discussions: [],
  skills: [],
  machineSkills: [],
  agents: [],
  teams: [],
  unassignedMemberIds: []
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('room_onboarding_seen:room_personal', 'true');
  const mockApi = window.electronAPI as any;
  mockApi.initializePersonalRoom.mockResolvedValue({
    success: true,
    room: { id: 'room_personal', name: 'Personal Room', sources: [] }
  });
  mockApi.getProjectData.mockResolvedValue(emptyRoomData);
  mockApi.loadTaskBoard.mockResolvedValue({ success: true, cards: [] });
  mockApi.loadProviders.mockResolvedValue({ success: true, providers: [] });
  mockApi.detectLocalAgents.mockResolvedValue({ success: true, agents: [] });
});

function renderApp() {
  return render(
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  );
}

test('opens Personal Room without a workspace gate or Source', async () => {
  renderApp();

  await waitFor(() => expect(screen.getByText('What should this Room move forward?')).toBeDefined());
  expect(screen.queryByText('Open Existing Workspace')).toBeNull();
  expect(screen.getByText('What should this Room move forward?')).toBeDefined();
  expect(screen.getByText(/No Source attached/i)).toBeDefined();
  expect(window.electronAPI.getProjectData).toHaveBeenCalledWith('room_personal');
});

test('shows an Attach Source CTA instead of an IPC error on Files', async () => {
  renderApp();
  await waitFor(() => expect(screen.getByText('What should this Room move forward?')).toBeDefined());

  fireEvent.click(screen.getByText('Files'));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'No Source attached' })).toBeDefined());
  fireEvent.click(screen.getAllByRole('button', { name: /Attach Source folder/ })[0]);

  expect(window.electronAPI.attachRoomSource).toHaveBeenCalledWith('room_personal');
  expect(screen.queryByText(/active workspace source/i)).toBeNull();
});

test('runs a Source scan with room and source identities', async () => {
  const mockApi = window.electronAPI as any;
  const roomWithSource = {
    id: 'room_personal',
    name: 'Personal Room',
    sources: [{ id: 'src_repo', name: 'Example Source', attachedAt: new Date().toISOString() }],
    activeSourceId: 'src_repo'
  };
  mockApi.initializePersonalRoom.mockResolvedValue({
    success: true,
    room: roomWithSource
  });
  mockApi.getProjectData.mockResolvedValue({
    ...emptyRoomData,
    room: roomWithSource
  });
  mockApi.runScan.mockResolvedValue({ success: true });

  renderApp();

  await waitFor(() => expect(
    screen.getByRole('button', { name: /Scan active Source/i })
  ).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: /Scan active Source/i }));

  await waitFor(() => expect(mockApi.runScan).toHaveBeenCalledWith(
    'room_personal',
    'src_repo'
  ));
});
