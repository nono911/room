import type {
  WorkspaceFileEntry,
  ContextPickerItem,
  SkillPreviewResult,
  DetectedAgent,
  MaskedProvider,
  TaskBoardCard,
  DiscussionIpcEvent,
  MemberTeam
} from '../types/domain.js';

export interface ElectronAPI {
  selectProjectDir: () => Promise<{ path: string; isRoomProject: boolean } | null>;
  openProjectDir: (dirPath: string) => Promise<{ path: string; isRoomProject: boolean } | null>;
  createWorkspace: (workspaceName: string) => Promise<{ success: boolean; path?: string; isRoomProject?: boolean; error?: string } | null>;
  roomInit: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  getProjectData: (dirPath: string) => Promise<{
    success: boolean;
    projectMd: string;
    archMd: string;
    hasScanData?: boolean;
    workspaceDiagnostics?: Array<{ source: string; message: string }>;
    tasks: string[];
    taskRuns?: string[];
    decisions: string[];
    reviews: string[];
    documents?: string[];
    discussions: string[];
    skills: string[];
    agents: any[];
    teams?: MemberTeam[];
    unassignedMemberIds?: string[];
    error?: string;
  }>;
  readRoomFile: (dirPath: string, section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions' | 'skills', filename: string) => Promise<{ success: boolean; content?: string; sourceSection?: string; error?: string }>;
  listWorkspaceFiles: (dirPath: string) => Promise<{ success: boolean; files?: WorkspaceFileEntry[]; truncated?: boolean; error?: string }>;
  searchContextItems: (dirPath: string, query?: string) => Promise<{ success: boolean; items?: ContextPickerItem[]; error?: string }>;
  readWorkspaceFile: (dirPath: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  runScan: (dirPath: string, mainAgent?: string, modelName?: string, allowDangerousCli?: boolean) => Promise<{ success: boolean; message?: string; error?: string }>;
  runDiscussion: (
    dirPath: string,
    topic: string,
    agentNames?: string[],
    options?: { maxRounds?: number; reviewMode?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; moderatorName?: string; autoSummary?: boolean; summaryAgentName?: string; useProjectSummaryAgent?: boolean }
  ) => Promise<{
    success: boolean;
    summary?: { filename: string; content: string };
    moderatorActions?: { type: 'task' | 'adr'; id?: string; title?: string; filename?: string }[];
    log?: {
      id: string;
      title: string;
      topic?: string;
      status: string;
      messages: {
        type?: 'user' | 'agent';
        agentName: string;
        providerName: string;
        modelName?: string;
        content: string;
        timestamp: string;
        contextMessages?: {
          type?: 'user' | 'agent';
          agentName: string;
          providerName: string;
          timestamp: string;
        }[];
        contextMetrics?: {
          estimatedHistoryTokens?: number;
          estimatedProjectContextTokens?: number;
          maxProjectContextTokens?: number;
          maxHistoryTokens?: number;
          maxMessageTokens?: number;
          projectContextTrimmed?: boolean;
          summaryUsed?: boolean;
          omittedMessageCount?: number;
          includedMessageCount?: number;
          totalLogMessages?: number;
        };
        references?: { author: string; reason?: string }[];
      }[];
    };
    error?: string;
  }>;
  runTask: (
    dirPath: string,
    task: string,
    options?: { taskType?: string; doerName?: string; reviewerNames?: string[]; maxCycles?: number; contextRefs?: string[]; associatedCardId?: string; continuedFromTaskId?: string; taskId?: string }
  ) => Promise<{
    success: boolean;
    result?: {
      id: string;
      title: string;
      task: string;
      taskType?: string;
      status: string;
      cycles: number;
      messages: {
        type?: 'user' | 'agent';
        agentName: string;
        providerName: string;
        modelName?: string;
        content: string;
        timestamp: string;
        contextMessages?: {
          type?: 'user' | 'agent';
          agentName: string;
          providerName: string;
          timestamp: string;
        }[];
        contextMetrics?: {
          estimatedHistoryTokens?: number;
          estimatedProjectContextTokens?: number;
          maxProjectContextTokens?: number;
          maxHistoryTokens?: number;
          maxMessageTokens?: number;
          projectContextTrimmed?: boolean;
          summaryUsed?: boolean;
          omittedMessageCount?: number;
          includedMessageCount?: number;
          totalLogMessages?: number;
        };
      }[];
      markdownFilename: string;
      jsonFilename: string;
      artifactFilename?: string;
      approvedBy?: string[];
      statusSummary?: string;
    };
    error?: string;
  }>;
  interruptRun: (runId: string, message: string) => Promise<{ success: boolean; error?: string }>;
  summarizeDiscussion: (dirPath: string, discussionId: string, options?: { agentNames?: string[]; summaryAgentName?: string; useProjectSummaryAgent?: boolean }) => Promise<{ success: boolean; filename?: string; content?: string; error?: string }>;
  generateTasksFromDiscussion: (dirPath: string, discussionId: string, options?: { moderatorName?: string }) => Promise<{ success: boolean; createdTaskCards?: TaskBoardCard[]; errors?: string[]; error?: string }>;
  loadTaskBoard: (dirPath: string) => Promise<{ success: boolean; cards?: TaskBoardCard[]; error?: string }>;
  onDiscussionEvent: (callback: (event: DiscussionIpcEvent) => void) => () => void;
  saveRoomFile: (dirPath: string, section: 'documents' | 'tasks', filename: string, content: string) => Promise<{ success: boolean; filename?: string; error?: string }>;
  saveContextFile: (dirPath: string, filename: 'overview.md' | 'structure.md', content: string) => Promise<{ success: boolean; error?: string }>;
  saveAgent: (dirPath: string, agent: any) => Promise<{ success: boolean; error?: string }>;
  deleteAgent: (dirPath: string, agentName: string) => Promise<{ success: boolean; error?: string }>;
  loadTeams: (
    dirPath: string
  ) => Promise<{
    success: boolean;
    teams?: MemberTeam[];
    diagnostics?: Array<{ filePath: string; error: string }>;
    error?: string;
    rollbackWarnings?: string[];
  }>;
  saveTeam: (dirPath: string, team: any) => Promise<{ success: boolean; team?: MemberTeam; error?: string; rollbackWarnings?: string[] }>;
  deleteTeam: (dirPath: string, teamId: string) => Promise<{ success: boolean; error?: string; rollbackWarnings?: string[] }>;
  updateTeamMembers: (dirPath: string, teamId: string, memberIds: string[]) => Promise<{ success: boolean; team?: MemberTeam; error?: string; rollbackWarnings?: string[] }>;
  createTeamWithMembers: (
    dirPath: string,
    team: unknown,
    members: unknown[],
    skillDrafts?: Array<{ name: string; content: string }>
  ) => Promise<{ success: boolean; team?: MemberTeam; members?: any[]; rollbackWarnings?: string[]; error?: string }>;
  addMembersToTeam: (
    dirPath: string,
    teamId: string,
    members: unknown[],
    skillDrafts?: Array<{ name: string; content: string }>
  ) => Promise<{ success: boolean; team?: MemberTeam; members?: any[]; rollbackWarnings?: string[]; error?: string }>;
  saveSkill: (dirPath: string, name: string, content: string, source?: 'skills' | 'roles') => Promise<{ success: boolean; error?: string }>;
  previewAgentSkills: (dirPath: string, agent: any) => Promise<{ success: boolean; error?: string } & Partial<SkillPreviewResult>>;
  detectLocalAgents: () => Promise<{ success: boolean; agents?: DetectedAgent[]; error?: string }>;
  loadProviders: () => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
  saveProvider: (provider: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
  deleteProvider: (providerId: string) => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
  testProvider: (providerId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  detectCliModels: (cliId: string) => Promise<{ success: boolean; models?: { value: string; label: string }[]; error?: string }>;
  detectApiModels: (providerId: string) => Promise<{ success: boolean; models?: { value: string; label: string }[]; error?: string }>;
  loadMcpConfig: (dirPath: string) => Promise<{ success: boolean; config?: any; error?: string }>;
  saveMcpConfig: (dirPath: string, config: any) => Promise<{ success: boolean; error?: string }>;
  loadProjectConfig: (dirPath: string) => Promise<{ success: boolean; config?: any; error?: string }>;
  saveProjectConfig: (dirPath: string, config: any) => Promise<{ success: boolean; error?: string }>;
}
