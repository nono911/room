import '@testing-library/jest-dom';
import { vi } from 'vitest';

const mockElectronAPI = {
  selectProjectDir: vi.fn().mockResolvedValue({ success: true, path: '/mock/path' }),
  openProjectDir: vi.fn().mockResolvedValue({ success: true }),
  createWorkspace: vi.fn().mockResolvedValue({ success: true }),
  roomInit: vi.fn().mockResolvedValue({ success: true }),
  getProjectData: vi.fn().mockResolvedValue({ success: true, data: {} }),
  readRoomFile: vi.fn().mockResolvedValue({ success: true, content: '' }),
  listWorkspaceFiles: vi.fn().mockResolvedValue({ success: true, files: [] }),
  browseWorkspaceFiles: vi.fn().mockResolvedValue({ success: true, files: [], truncated: false }),
  searchContextItems: vi.fn().mockResolvedValue({ success: true, items: [] }),
  readWorkspaceFile: vi.fn().mockResolvedValue({
    success: true,
    content: '',
    preview: { kind: 'text', content: '', mimeType: 'text/plain' }
  }),
  revealWorkspaceFile: vi.fn().mockResolvedValue({ success: true }),
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
  detectLocalAgents: vi.fn().mockResolvedValue({ success: true, agents: [] }),
  loadProviders: vi.fn().mockResolvedValue({ success: true, providers: [] }),
  saveProvider: vi.fn().mockResolvedValue({ success: true }),
  deleteProvider: vi.fn().mockResolvedValue({ success: true }),
  testProvider: vi.fn().mockResolvedValue({ success: true }),
  detectCliModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
  detectApiModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
  loadMcpConfig: vi.fn().mockResolvedValue({ success: true, config: {} }),
  saveMcpConfig: vi.fn().mockResolvedValue({ success: true }),
  loadProjectConfig: vi.fn().mockResolvedValue({ success: true, config: {} }),
  saveProjectConfig: vi.fn().mockResolvedValue({ success: true })
};

global.window = global.window || {};
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
  configurable: true
});
