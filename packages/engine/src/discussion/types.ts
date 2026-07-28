import type { MessageReference } from './references.js';
import type { CompiledDiscussionContext } from './contextCompiler.js';
import * as path from 'path';
import type { WorkspaceLocation } from '../workspace.js';
import type { ExecutionParticipantSnapshot } from './executionParticipants.js';

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
  participants: ExecutionParticipantSnapshot[];
  sourceProvenance: SourceProvenance;
}

export interface DiscussionLog {
  id: string;
  title: string;
  topic: string;
  status: 'active' | 'completed' | 'interrupted' | 'needs_revision' | 'approved' | 'blocked';
  messages: DiscussionMessage[];
  participants: ExecutionParticipantSnapshot[];
  sourceProvenance: SourceProvenance;
}

export type SourceProvenance =
  | { mode: 'room-only'; roomId: string; startedAt: string }
  | {
      mode: 'source';
      roomId: string;
      sourceId: string;
      sourceName: string;
      startedAt: string;
    };

export function createExecutionProvenance(workspace: WorkspaceLocation): SourceProvenance {
  const startedAt = new Date().toISOString();
  return workspace.sourceId && workspace.sourceRoot
    ? {
        mode: 'source',
        roomId: workspace.roomId,
        sourceId: workspace.sourceId,
        sourceName: workspace.sourceName || path.basename(workspace.sourceRoot),
        startedAt
      }
    : { mode: 'room-only', roomId: workspace.roomId, startedAt };
}

export function isSameExecutionSource(
  first: SourceProvenance,
  second: SourceProvenance
): boolean {
  return first.roomId === second.roomId
    && first.mode === second.mode
    && (first.mode === 'room-only' || (
      second.mode === 'source'
      && first.sourceId === second.sourceId
    ));
}
