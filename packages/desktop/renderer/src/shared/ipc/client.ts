import type { DiscussionIpcEvent, RoomArtifactSection } from '../../types/domain.js';

type TemporaryAgentPayload = {
  name: string;
  role: string;
  provider: string;
  modelName?: string;
  systemPrompt: string;
  skills?: string[];
  command?: string;
  cliPreset?: string;
  stdinFormat?: string;
  permissionMode?: string;
  strategy?: string;
};

export const api = {
  initializePersonalRoom: () => window.electronAPI.initializePersonalRoom(),
  attachRoomSource: (roomId: string) => window.electronAPI.attachRoomSource(roomId),
  detachRoomSource: (roomId: string, sourceId: string) =>
    window.electronAPI.detachRoomSource(roomId, sourceId),
  setActiveRoomSource: (roomId: string, sourceId?: string) =>
    window.electronAPI.setActiveRoomSource(roomId, sourceId),
  getProjectData: (roomId: string) => window.electronAPI.getProjectData(roomId),
  listRoomArtifacts: (roomId: string, section: RoomArtifactSection, cursor?: string) =>
    window.electronAPI.listRoomArtifacts(roomId, section, cursor),
  listRoomTaskRuns: (roomId: string, cursor?: string) =>
    window.electronAPI.listRoomTaskRuns(roomId, cursor),
  readRoomFile: (roomId: string, section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions' | 'skills', filename: string) =>
    window.electronAPI.readRoomFile(roomId, section, filename),
  listWorkspaceFiles: (roomId: string, sourceId: string) =>
    window.electronAPI.listWorkspaceFiles(roomId, sourceId),
  browseWorkspaceFiles: (roomId: string, sourceId: string, directory = '', query = '') =>
    window.electronAPI.browseWorkspaceFiles(roomId, sourceId, directory, query),
  searchContextItems: (roomId: string, sourceId?: string, query?: string) =>
    window.electronAPI.searchContextItems(roomId, sourceId, query),
  readWorkspaceFile: (roomId: string, sourceId: string, filePath: string) =>
    window.electronAPI.readWorkspaceFile(roomId, sourceId, filePath),
  getSourceGitStatus: (roomId: string, sourceId: string) =>
    window.electronAPI.getSourceGitStatus(roomId, sourceId),
  loadContextSets: (roomId: string) => window.electronAPI.loadContextSets(roomId),
  saveContextSets: (roomId: string, contextSets: import('../../types/domain.js').ContextSet[]) =>
    window.electronAPI.saveContextSets(roomId, contextSets),
  runScan: (roomId: string, sourceId: string) =>
    window.electronAPI.runScan(roomId, sourceId),
  runDiscussion: (
    roomId: string,
    topic: string,
    participantRefs?: string[],
    options?: { sourceId?: string; maxRounds?: number; reviewMode?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; moderatorRef?: string; autoSummary?: boolean; summaryAgentRef?: string; temporaryAgents?: TemporaryAgentPayload[] }
  ) => window.electronAPI.runDiscussion(roomId, topic, participantRefs, options),
  runTask: (
    roomId: string,
    task: string,
    options?: { sourceId?: string; taskType?: string; doerRef?: string; reviewerRefs?: string[]; maxCycles?: number; contextRefs?: string[]; associatedCardId?: string; continuedFromTaskId?: string; temporaryAgents?: TemporaryAgentPayload[] }
  ) => window.electronAPI.runTask(roomId, task, options),
  interruptRun: (roomId: string, runId: string, message: string) =>
    window.electronAPI.interruptRun(roomId, runId, message),
  summarizeDiscussion: (roomId: string, discussionId: string, options?: { participantRefs?: string[]; summaryAgentRef?: string; temporaryAgents?: TemporaryAgentPayload[] }) =>
    window.electronAPI.summarizeDiscussion(roomId, discussionId, options),
  generateTasksFromDiscussion: (roomId: string, discussionId: string, options?: { moderatorRef?: string }) =>
    window.electronAPI.generateTasksFromDiscussion(roomId, discussionId, options),
  loadTaskBoard: (roomId: string) => window.electronAPI.loadTaskBoard(roomId),
  onDiscussionEvent: (callback: (event: DiscussionIpcEvent) => void) => window.electronAPI.onDiscussionEvent(callback),
  saveRoomFile: (roomId: string, section: 'documents' | 'tasks', filename: string, content: string) =>
    window.electronAPI.saveRoomFile(roomId, section, filename, content),
  saveContextFile: (roomId: string, filename: 'overview.md' | 'structure.md', content: string) =>
    window.electronAPI.saveContextFile(roomId, filename, content),
  saveAgent: (roomId: string, agent: any) => window.electronAPI.saveAgent(roomId, agent),
  deleteAgent: (roomId: string, agentName: string, memberId?: string) => window.electronAPI.deleteAgent(roomId, agentName, memberId),
  loadTeams: (roomId: string) => window.electronAPI.loadTeams(roomId),
  saveTeam: (roomId: string, team: any) => window.electronAPI.saveTeam(roomId, team),
  deleteTeam: (roomId: string, teamId: string) => window.electronAPI.deleteTeam(roomId, teamId),
  updateTeamMembers: (roomId: string, teamId: string, memberIds: string[]) =>
    window.electronAPI.updateTeamMembers(roomId, teamId, memberIds),
  createTeamWithMembers: (
    roomId: string,
    team: unknown,
    members: unknown[],
    skillDrafts: Array<{ name: string; content: string }> = []
  ) => window.electronAPI.createTeamWithMembers(roomId, team, members, skillDrafts),
  addMembersToTeam: (
    roomId: string,
    teamId: string,
    members: unknown[],
    skillDrafts: Array<{ name: string; content: string }> = []
  ) => window.electronAPI.addMembersToTeam(roomId, teamId, members, skillDrafts),
  saveSkill: (roomId: string, name: string, content: string, source?: 'skills' | 'roles') => window.electronAPI.saveSkill(roomId, name, content, source),
  previewAgentSkills: (roomId: string, agent: any) => window.electronAPI.previewAgentSkills(roomId, agent),
  detectLocalAgents: () => window.electronAPI.detectLocalAgents(),
  loadProviders: () => window.electronAPI.loadProviders(),
  saveProvider: (provider: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => window.electronAPI.saveProvider(provider),
  deleteProvider: (providerId: string) => window.electronAPI.deleteProvider(providerId),
  testProvider: (providerId: string) => window.electronAPI.testProvider(providerId),
  detectApiModels: (providerId: string) => window.electronAPI.detectApiModels(providerId),
  loadMcpConfig: (roomId: string) => window.electronAPI.loadMcpConfig(roomId),
  saveMcpConfig: (roomId: string, config: any) => window.electronAPI.saveMcpConfig(roomId, config),
};
