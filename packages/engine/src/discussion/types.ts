import type { MessageReference } from './references.js';
import type { CompiledDiscussionContext } from './contextCompiler.js';

export interface DiscussionMessage {
  id?: string;
  type?: 'user' | 'agent';
  agentName: string;
  providerName: string;
  modelName?: string;
  content: string;
  timestamp: string;
  round?: number;
  references?: MessageReference[];
  contextMessages?: {
    id?: string;
    promptNumber?: number;
    logIndex?: number;
    type?: 'user' | 'agent';
    agentName: string;
    providerName: string;
    timestamp: string;
  }[];
  contextMetrics?: CompiledDiscussionContext['metrics'] & {
    summaryUsed: boolean;
    omittedMessageCount: number;
    includedMessageCount: number;
    totalLogMessages: number;
  };
}

export interface CodingTaskResult {
  id: string;
  title: string;
  task: string;
  taskType?: string;
  status: 'approved' | 'needs_revision' | 'blocked' | 'interrupted';
  cycles: number;
  messages: DiscussionMessage[];
  markdownFilename: string;
  jsonFilename: string;
  artifactFilename?: string;
  approvedBy?: string[];
  statusSummary?: string;
  associatedCardId?: string;
  continuedFromTaskId?: string;
  sourceProvenance?: SourceProvenance;
}

export interface DiscussionLog {
  id: string;
  title: string;
  topic: string;
  status: 'active' | 'completed' | 'interrupted' | 'needs_revision' | 'approved' | 'blocked';
  messages: DiscussionMessage[];
  sourceProvenance?: SourceProvenance;
}

export type SourceProvenance =
  | { mode: 'room-only' }
  | { mode: 'source'; sourceId: string; sourceName: string };
