export interface MemberTeam {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomSourceSummary {
  id: string;
  name: string;
  attachedAt: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  sources: RoomSourceSummary[];
  activeSourceId?: string;
}

export type RoomArtifactSection =
  | 'documents'
  | 'reviews'
  | 'discussions'
  | 'tasks'
  | 'decisions';

export interface RoomListPageState {
  hasMore: boolean;
  nextCursor?: string;
  truncated: boolean;
}

export interface MachineSkillSummary {
  reference: string;
  name: string;
  description?: string;
  source: 'codex' | 'agents' | 'plugin';
  sourceLabel: string;
  relativePath: string;
  modifiedAt: string;
}

export type RendererSourceProvenance =
  | { mode: 'room-only'; roomId: string; startedAt: string }
  | {
      mode: 'source';
      roomId: string;
      sourceId: string;
      sourceName: string;
      startedAt: string;
    };

export interface RendererMessage {
  id?: string;
  type?: 'user' | 'agent';
  agentName: string;
  providerName: string;
  modelName?: string;
  content: string;
  timestamp: string;
  round?: number;
  references?: unknown[];
  contextMessages?: Array<{
    id?: string;
    promptNumber?: number;
    logIndex?: number;
    type?: 'user' | 'agent';
    agentName: string;
    providerName: string;
    timestamp: string;
  }>;
  contextMetrics?: UIMessage['contextMetrics'];
}

export interface RendererDiscussionLog {
  id: string;
  title: string;
  topic: string;
  status: 'active' | 'completed' | 'interrupted' | 'needs_revision' | 'approved' | 'blocked';
  messages: RendererMessage[];
  sourceProvenance: RendererSourceProvenance;
}

export interface RendererTaskResult {
  id: string;
  title: string;
  task: string;
  taskType?: string;
  status: 'approved' | 'needs_revision' | 'blocked' | 'interrupted';
  cycles: number;
  messages: RendererMessage[];
  markdownFilename: string;
  jsonFilename: string;
  artifactFilename?: string;
  approvedBy?: string[];
  statusSummary?: string;
  associatedCardId?: string;
  continuedFromTaskId?: string;
  sourceProvenance: RendererSourceProvenance;
}

export interface TaskRunSummary {
  filename: string;
  id: string;
  title: string;
  status: string;
  cycles: number;
  statusSummary?: string;
  associatedCardId?: string;
  sourceProvenance?: RendererSourceProvenance;
}

export interface ModeratorAction {
  type: 'task' | 'adr' | 'document';
  id?: string;
  title?: string;
  filename?: string;
}

export interface ProjectData {
  room?: RoomSummary;
  projectMd: string;
  archMd: string;
  hasScanData?: boolean;
  workspaceDiagnostics?: Array<{ source: string; message: string }>;
  tasks: string[];
  taskRuns?: Array<string | TaskRunSummary>;
  decisions: string[];
  reviews: string[];
  documents: string[];
  discussions: string[];
  skills: string[];
  machineSkills?: MachineSkillSummary[];
  machineSkillsTruncated?: boolean;
  agents: any[];
  teams?: MemberTeam[];
  unassignedMemberIds?: string[];
  artifactListPagination?: Partial<Record<RoomArtifactSection, RoomListPageState>>;
  taskRunPagination?: RoomListPageState;
}

export interface DetectedAgent {
  id: string;
  name: string;
  available: boolean;
  version: string | null;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: 'file' | 'directory';
  extension?: string;
  childCount?: number;
}

export interface SourceGitStatus {
  repository: boolean;
  branch?: string;
  commit?: string;
  unsupportedReason?: string;
}

export type WorkspaceFilePreview =
  | {
      kind: 'text';
      content: string;
      mimeType: string;
      language?: string;
    }
  | {
      kind: 'image';
      dataUrl: string;
      mimeType: string;
    }
  | {
      kind: 'pdf';
      dataUrl: string;
      mimeType: string;
    }
  | {
      kind: 'binary';
      mimeType: string;
      size: number;
      message: string;
    };

export interface ContextSet {
  id: string;
  name: string;
  refs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContextPickerItem {
  ref: string;
  label: string;
  type: 'workspace' | 'task' | 'doc' | 'discussion' | 'file';
  path?: string;
  detail: string;
  modifiedAt?: string;
  size?: number;
}

export interface SkillPreviewResult {
  delivery: string;
  readableCount: number;
  totalCount: number;
  items: {
    filename: string;
    reference?: string;
    readable: boolean;
    source?: 'skills' | 'roles' | 'machine';
    sourceLabel?: string;
    bytes?: number;
    heading?: string;
    error?: string;
  }[];
}

export interface MaskedProvider {
  id: string;
  label: string;
  kind: 'gemini' | 'anthropic' | 'openai-compatible';
  baseUrl?: string;
  builtIn: boolean;
  hasKey: boolean;
}

export interface TaskBoardCard {
  id: string;
  title: string;
  kind: 'epic' | 'task' | 'subtask';
  parentId?: string;
  details?: string;
  status: 'todo' | 'in_progress' | 'done';
  sourceDiscussionId?: string;
  createdAt: string;
  assignee?: string;
}

export interface UIMessage {
  id?: string;
  author: string;
  role: string;
  time: string;
  text: string;
  streaming?: boolean;
  progressStep?: number;
  contextSummary?: string;
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
  round?: number;
}

export type DiscussionIpcEvent =
  | {
      type: 'discussion_started';
      discussionId: string;
      title: string;
    }
  | {
      type: 'agent_started';
      discussionId: string;
      agentName: string;
      providerName: string;
      modelName?: string;
      role: string;
      round: number;
      timestamp: string;
    }
  | {
      type: 'agent_chunk';
      discussionId: string;
      agentName: string;
      providerName: string;
      modelName?: string;
      round: number;
      chunk: string;
    }
  | {
      type: 'message_completed';
      discussionId: string;
      round: number;
      message: {
        agentName: string;
        providerName: string;
        modelName?: string;
        content: string;
        timestamp: string;
        contextMessages?: {
          agentName: string;
          providerName: string;
          timestamp: string;
        }[];
        contextMetrics?: UIMessage['contextMetrics'];
      };
    }
  | {
      type: 'agent_error';
      discussionId: string;
      agentName: string;
      providerName: string;
      modelName?: string;
      round: number;
      error: string;
    }
  | {
      type: 'discussion_completed';
      discussionId: string;
    }
  | {
      type: 'discussion_interrupted';
      discussionId: string;
      message: {
        agentName: string;
        providerName: string;
        content: string;
        timestamp: string;
        round?: number;
      };
      reason: string;
    }
  | {
      type: 'discussion_failed';
      discussionId: string;
      error: string;
    }
  | {
      type: 'context_summary_failed';
      discussionId: string;
      round: number;
      error?: string;
    }
  | {
      type: 'context_summary_generated';
      discussionId: string;
      round: number;
    }
  | {
      type: 'context_summary_reused';
      discussionId: string;
      round: number;
    };

export type LocalCliPermissionMode = 'safe' | 'dangerous';

export type TemplateSkill = {
  filename: string;
  title: string;
  content: string;
};
