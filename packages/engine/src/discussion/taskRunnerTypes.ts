import type { AgentConfig } from '../agents/registry.js';
import type { DiscussionMessage, SourceProvenance } from './types.js';
import type { ApprovedMachineSkillSnapshot } from '../skills/machineCatalog.js';
import type { RoomSkillSnapshot } from './roomSkillSnapshot.js';
import type { ExecutionParticipantSnapshot } from './executionParticipants.js';

export interface CodingTaskEvent {
  type: string;
  discussionId: string;
  message?: DiscussionMessage;
  agentName?: string;
  providerName?: string;
  modelName?: string;
  round?: number;
  chunk?: string;
  error?: string;
  role?: string;
  timestamp?: string;
  log?: { id: string; title: string; topic: string; status: string; messages: DiscussionMessage[] };
  reason?: string | null;
  title?: string;
}

export interface CodingTaskRunOptions {
  onEvent?: (event: CodingTaskEvent) => void;
  additionalContext?: string;
  taskType?: string;
  getInterruptMessage?: () => string | null;
  associatedCardId?: string;
  continuedFromTaskId?: string;
  temporaryAgents?: AgentConfig[];
  sourceProvenance?: SourceProvenance;
  approvedMachineSkills?: readonly ApprovedMachineSkillSnapshot[];
  roomSkillSnapshots?: readonly RoomSkillSnapshot[];
  developer?: AgentConfig;
  reviewers?: readonly AgentConfig[];
  executionParticipants?: readonly ExecutionParticipantSnapshot[];
}
