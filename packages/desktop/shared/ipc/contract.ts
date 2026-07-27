import type {
  ContextPickerItem,
  ContextSet,
  DetectedAgent,
  DiscussionIpcEvent,
  MachineSkillSummary,
  MaskedProvider,
  MemberTeam,
  RoomSummary,
  SkillPreviewResult,
  TaskBoardCard,
  WorkspaceFileEntry,
  WorkspaceFilePreview
} from '../types/domain.js';

type Result = { success: boolean; error?: string };
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
type RunOptions = {
  sourceId?: string;
  contextRefs?: string[];
  temporaryAgents?: TemporaryAgentPayload[];
};

export interface ElectronAPI {
  initializePersonalRoom: () => Promise<Result & { room?: RoomSummary }>;
  attachRoomSource: (roomId: string) => Promise<Result & { room?: RoomSummary; canceled?: boolean }>;
  detachRoomSource: (roomId: string, sourceId: string) => Promise<Result & { room?: RoomSummary }>;
  setActiveRoomSource: (roomId: string, sourceId?: string) => Promise<Result & { room?: RoomSummary }>;
  getProjectData: (roomId: string) => Promise<Result & {
    room?: RoomSummary;
    projectMd?: string;
    archMd?: string;
    hasScanData?: boolean;
    workspaceDiagnostics?: Array<{ source: string; message: string }>;
    tasks?: string[];
    taskRuns?: unknown[];
    decisions?: string[];
    reviews?: string[];
    documents?: string[];
    discussions?: string[];
    skills?: string[];
    machineSkills?: MachineSkillSummary[];
    agents?: unknown[];
    teams?: MemberTeam[];
    unassignedMemberIds?: string[];
  }>;
  readRoomFile: (
    roomId: string,
    section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions' | 'skills',
    filename: string
  ) => Promise<Result & { content?: string; sourceSection?: string }>;
  listWorkspaceFiles: (
    roomId: string,
    sourceId: string
  ) => Promise<Result & { files?: WorkspaceFileEntry[]; truncated?: boolean }>;
  browseWorkspaceFiles: (
    roomId: string,
    sourceId: string,
    directory?: string,
    query?: string
  ) => Promise<Result & { files?: WorkspaceFileEntry[]; truncated?: boolean }>;
  searchContextItems: (
    roomId: string,
    sourceId?: string,
    query?: string
  ) => Promise<Result & { items?: ContextPickerItem[] }>;
  readWorkspaceFile: (
    roomId: string,
    sourceId: string,
    filePath: string
  ) => Promise<Result & { content?: string; preview?: WorkspaceFilePreview }>;
  revealWorkspaceFile: (roomId: string, sourceId: string, filePath: string) => Promise<Result>;
  loadContextSets: (roomId: string) => Promise<Result & { contextSets?: ContextSet[] }>;
  saveContextSets: (roomId: string, contextSets: ContextSet[]) => Promise<Result>;
  runScan: (
    roomId: string,
    sourceId: string,
    mainAgent?: string,
    modelName?: string,
    allowDangerousCli?: boolean
  ) => Promise<Result & { message?: string }>;
  runDiscussion: (
    roomId: string,
    topic: string,
    agentNames?: string[],
    options?: RunOptions & {
      maxRounds?: number;
      reviewMode?: boolean;
      allowReadOnlyTools?: boolean;
      discussionId?: string;
      qualityGate?: boolean;
      moderatorName?: string;
      autoSummary?: boolean;
      summaryAgentName?: string;
      useProjectSummaryAgent?: boolean;
    }
  ) => Promise<Result & { log?: any; summary?: { filename: string; content: string }; moderatorActions?: any[] }>;
  runTask: (
    roomId: string,
    task: string,
    options?: RunOptions & {
      taskType?: string;
      doerName?: string;
      reviewerNames?: string[];
      maxCycles?: number;
      associatedCardId?: string;
      continuedFromTaskId?: string;
      taskId?: string;
    }
  ) => Promise<Result & { result?: any }>;
  interruptRun: (runId: string, message: string) => Promise<Result>;
  summarizeDiscussion: (
    roomId: string,
    discussionId: string,
    options?: { sourceId?: string; agentNames?: string[]; summaryAgentName?: string; useProjectSummaryAgent?: boolean }
  ) => Promise<Result & { filename?: string; content?: string }>;
  generateTasksFromDiscussion: (
    roomId: string,
    discussionId: string,
    options?: { sourceId?: string; moderatorName?: string }
  ) => Promise<Result & { createdTaskCards?: TaskBoardCard[]; errors?: string[] }>;
  loadTaskBoard: (roomId: string) => Promise<Result & { cards?: TaskBoardCard[] }>;
  onDiscussionEvent: (callback: (event: DiscussionIpcEvent) => void) => () => void;
  saveRoomFile: (roomId: string, section: 'documents' | 'tasks', filename: string, content: string) => Promise<Result & { filename?: string }>;
  saveContextFile: (roomId: string, filename: 'overview.md' | 'structure.md', content: string) => Promise<Result>;
  saveAgent: (roomId: string, agent: any) => Promise<Result>;
  deleteAgent: (roomId: string, agentName: string, memberId?: string) => Promise<Result>;
  loadTeams: (roomId: string) => Promise<Result & { teams?: MemberTeam[]; diagnostics?: Array<{ filePath: string; error: string }> }>;
  saveTeam: (roomId: string, team: any) => Promise<Result & { team?: MemberTeam }>;
  deleteTeam: (roomId: string, teamId: string) => Promise<Result>;
  updateTeamMembers: (roomId: string, teamId: string, memberIds: string[]) => Promise<Result & { team?: MemberTeam }>;
  createTeamWithMembers: (
    roomId: string,
    team: unknown,
    members: unknown[],
    skillDrafts?: Array<{ name: string; content: string }>
  ) => Promise<Result & { team?: MemberTeam; members?: any[]; rollbackWarnings?: string[] }>;
  addMembersToTeam: (
    roomId: string,
    teamId: string,
    members: unknown[],
    skillDrafts?: Array<{ name: string; content: string }>
  ) => Promise<Result & { team?: MemberTeam; members?: any[]; rollbackWarnings?: string[] }>;
  saveSkill: (roomId: string, name: string, content: string, source?: 'skills' | 'roles') => Promise<Result>;
  previewAgentSkills: (roomId: string, agent: any) => Promise<Result & Partial<SkillPreviewResult>>;
  detectLocalAgents: () => Promise<Result & { agents?: DetectedAgent[] }>;
  loadProviders: () => Promise<Result & { providers?: MaskedProvider[] }>;
  saveProvider: (provider: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => Promise<Result & { providers?: MaskedProvider[] }>;
  deleteProvider: (providerId: string) => Promise<Result & { providers?: MaskedProvider[] }>;
  testProvider: (providerId: string) => Promise<Result & { message?: string }>;
  detectCliModels: (cliId: string) => Promise<Result & { models?: Array<{ value: string; label: string }> }>;
  detectApiModels: (providerId: string) => Promise<Result & { models?: Array<{ value: string; label: string }> }>;
  loadMcpConfig: (roomId: string) => Promise<Result & { config?: any }>;
  saveMcpConfig: (roomId: string, config: any) => Promise<Result>;
  loadProjectConfig: (roomId: string) => Promise<Result & { config?: any }>;
  saveProjectConfig: (roomId: string, config: any) => Promise<Result>;
}
