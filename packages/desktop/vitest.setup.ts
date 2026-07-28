import '@testing-library/jest-dom';
import { vi } from 'vitest';

const mockElectronAPI = {
  initializePersonalRoom: vi.fn().mockResolvedValue({
    success: true,
    room: { id: 'room_personal', name: 'Personal Room', sources: [] }
  }),
  attachRoomSource: vi.fn().mockResolvedValue({ success: true }),
  detachRoomSource: vi.fn().mockResolvedValue({ success: true }),
  setActiveRoomSource: vi.fn().mockResolvedValue({ success: true }),
  getProjectData: vi.fn().mockResolvedValue({ success: true, data: {} }),
  listRoomArtifacts: vi.fn().mockResolvedValue({ success: true, files: [], hasMore: false }),
  listRoomTaskRuns: vi.fn().mockResolvedValue({ success: true, taskRuns: [], hasMore: false }),
  readRoomFile: vi.fn().mockResolvedValue({ success: true, content: '' }),
  listWorkspaceFiles: vi.fn().mockResolvedValue({ success: true, files: [] }),
  browseWorkspaceFiles: vi.fn().mockResolvedValue({ success: true, files: [], truncated: false }),
  searchContextItems: vi.fn().mockResolvedValue({ success: true, items: [] }),
  readWorkspaceFile: vi.fn().mockResolvedValue({
    success: true,
    content: '',
    preview: { kind: 'text', content: '', mimeType: 'text/plain' }
  }),
  getSourceGitStatus: vi.fn().mockResolvedValue({
    success: true,
    git: { repository: false, changed: 0, staged: 0, untracked: 0 }
  }),
  loadContextSets: vi.fn().mockResolvedValue({ success: true, contextSets: [] }),
  saveContextSets: vi.fn().mockResolvedValue({ success: true }),
  runScan: vi.fn().mockResolvedValue({ success: true }),
  runDiscussion: vi.fn().mockResolvedValue({ success: true }),
  runTask: vi.fn().mockResolvedValue({ success: true }),
  summarizeDiscussion: vi.fn().mockResolvedValue({ success: true }),
  generateTasksFromDiscussion: vi.fn().mockResolvedValue({ success: true }),
  loadTaskBoard: vi.fn().mockResolvedValue({ success: true, board: { todo: [], in_progress: [], done: [] } }),
  onDiscussionEvent: vi.fn().mockReturnValue(vi.fn()), // Returns a unsubscribe function
  saveRoomFile: vi.fn().mockResolvedValue({ success: true }),
  saveContextFile: vi.fn().mockResolvedValue({ success: true }),
  saveSkill: vi.fn().mockResolvedValue({ success: true }),
  previewAgentSkills: vi.fn().mockResolvedValue({ success: true, skills: [] }),
  saveAgent: vi.fn().mockResolvedValue({ success: true }),
  deleteAgent: vi.fn().mockResolvedValue({ success: true }),
  loadTeams: vi.fn().mockResolvedValue({ success: true, teams: [] }),
  saveTeam: vi.fn().mockResolvedValue({ success: true }),
  deleteTeam: vi.fn().mockResolvedValue({ success: true }),
  updateTeamMembers: vi.fn().mockResolvedValue({ success: true }),
  createTeamWithMembers: vi.fn().mockResolvedValue({ success: true }),
  addMembersToTeam: vi.fn().mockResolvedValue({ success: true }),
  detectLocalAgents: vi.fn().mockResolvedValue({ success: true, agents: [] }),
  loadProviders: vi.fn().mockResolvedValue({ success: true, providers: [] }),
  saveProvider: vi.fn().mockResolvedValue({ success: true }),
  deleteProvider: vi.fn().mockResolvedValue({ success: true }),
  testProvider: vi.fn().mockResolvedValue({ success: true }),
  detectApiModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
  loadMcpConfig: vi.fn().mockResolvedValue({ success: true, config: {} }),
  saveMcpConfig: vi.fn().mockResolvedValue({ success: true })
};

global.window = global.window || {};
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
  configurable: true
});
