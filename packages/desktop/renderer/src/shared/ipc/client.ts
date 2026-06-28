import type { DiscussionIpcEvent } from '../../types/domain.js';

export const api = {
  selectProjectDir: () => window.electronAPI.selectProjectDir(),
  openProjectDir: (dirPath: string) => window.electronAPI.openProjectDir(dirPath),
  createWorkspace: (workspaceName: string) => window.electronAPI.createWorkspace(workspaceName),
  roomInit: (dirPath: string) => window.electronAPI.roomInit(dirPath),
  getProjectData: (dirPath: string) => window.electronAPI.getProjectData(dirPath),
  readRoomFile: (dirPath: string, section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions' | 'skills', filename: string) =>
    window.electronAPI.readRoomFile(dirPath, section, filename),
  listWorkspaceFiles: (dirPath: string) => window.electronAPI.listWorkspaceFiles(dirPath),
  searchContextItems: (dirPath: string, query?: string) => window.electronAPI.searchContextItems(dirPath, query),
  readWorkspaceFile: (dirPath: string, filePath: string) => window.electronAPI.readWorkspaceFile(dirPath, filePath),
  runScan: (dirPath: string, mainAgent?: string, modelName?: string, allowDangerousCli?: boolean) =>
    window.electronAPI.runScan(dirPath, mainAgent, modelName, allowDangerousCli),
  runDiscussion: (
    dirPath: string,
    topic: string,
    agentNames?: string[],
    options?: { maxRounds?: number; reviewMode?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; moderatorName?: string; autoSummary?: boolean; summaryAgentName?: string; useProjectSummaryAgent?: boolean }
  ) => window.electronAPI.runDiscussion(dirPath, topic, agentNames, options),
  runTask: (
    dirPath: string,
    task: string,
    options?: { taskType?: string; doerName?: string; reviewerNames?: string[]; maxCycles?: number; contextRefs?: string[]; associatedCardId?: string; continuedFromTaskId?: string; taskId?: string }
  ) => window.electronAPI.runTask(dirPath, task, options),
  interruptRun: (runId: string, message: string) => window.electronAPI.interruptRun(runId, message),
  summarizeDiscussion: (dirPath: string, discussionId: string, options?: { agentNames?: string[]; summaryAgentName?: string; useProjectSummaryAgent?: boolean }) =>
    window.electronAPI.summarizeDiscussion(dirPath, discussionId, options),
  generateTasksFromDiscussion: (dirPath: string, discussionId: string, options?: { moderatorName?: string }) =>
    window.electronAPI.generateTasksFromDiscussion(dirPath, discussionId, options),
  loadTaskBoard: (dirPath: string) => window.electronAPI.loadTaskBoard(dirPath),
  onDiscussionEvent: (callback: (event: DiscussionIpcEvent) => void) => window.electronAPI.onDiscussionEvent(callback),
  saveRoomFile: (dirPath: string, section: 'documents' | 'tasks', filename: string, content: string) =>
    window.electronAPI.saveRoomFile(dirPath, section, filename, content),
  saveContextFile: (dirPath: string, filename: 'overview.md' | 'structure.md', content: string) =>
    window.electronAPI.saveContextFile(dirPath, filename, content),
  saveAgent: (dirPath: string, agent: any) => window.electronAPI.saveAgent(dirPath, agent),
  deleteAgent: (dirPath: string, agentName: string) => window.electronAPI.deleteAgent(dirPath, agentName),
  saveSkill: (dirPath: string, name: string, content: string, source?: 'skills' | 'roles') => window.electronAPI.saveSkill(dirPath, name, content, source),
  previewAgentSkills: (dirPath: string, agent: any) => window.electronAPI.previewAgentSkills(dirPath, agent),
  detectLocalAgents: () => window.electronAPI.detectLocalAgents(),
  loadProviders: () => window.electronAPI.loadProviders(),
  saveProvider: (provider: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => window.electronAPI.saveProvider(provider),
  deleteProvider: (providerId: string) => window.electronAPI.deleteProvider(providerId),
  testProvider: (providerId: string) => window.electronAPI.testProvider(providerId),
  detectCliModels: (cliId: string) => window.electronAPI.detectCliModels(cliId),
  detectApiModels: (providerId: string) => window.electronAPI.detectApiModels(providerId),
  loadMcpConfig: (dirPath: string) => window.electronAPI.loadMcpConfig(dirPath),
  saveMcpConfig: (dirPath: string, config: any) => window.electronAPI.saveMcpConfig(dirPath, config),
  loadProjectConfig: (dirPath: string) => window.electronAPI.loadProjectConfig(dirPath),
  saveProjectConfig: (dirPath: string, config: any) => window.electronAPI.saveProjectConfig(dirPath, config)
};
