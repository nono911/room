export interface MemberTeam {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectData {
  projectMd: string;
  archMd: string;
  hasScanData?: boolean;
  workspaceDiagnostics?: Array<{ source: string; message: string }>;
  tasks: string[];
  taskRuns?: any[];
  decisions: string[];
  reviews: string[];
  documents: string[];
  discussions: string[];
  skills: string[];
  agents: any[];
  teams?: MemberTeam[];
  unassignedMemberIds?: string[];
}

export interface DetectedAgent {
  id: string;
  name: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind?: 'file' | 'directory';
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
    readable: boolean;
    source?: 'skills' | 'roles';
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
      log: any;
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

export interface ProjectConfigState {
  mainAgent: string;
  modelName?: string;
  allowDangerousCli?: boolean;
}

export type TemplateSkill = {
  filename: string;
  title: string;
  content: string;
};
