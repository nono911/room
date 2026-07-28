import type {
  CodingTaskResult,
  DiscussionLog,
  DiscussionMessage,
  SourceProvenance
} from '@room/engine';
import type {
  RendererDiscussionLog,
  DiscussionIpcEvent,
  RendererMessage,
  RendererSourceProvenance,
  RendererTaskResult
} from '../../shared/types/domain.js';

export interface EngineRendererEvent {
  type: string;
  discussionId: string;
  title?: string;
  message?: DiscussionMessage;
  agentName?: string;
  providerName?: string;
  modelName?: string;
  round?: number;
  chunk?: string;
  error?: string;
  reason?: string | null;
  role?: string;
  timestamp?: string;
}

const STREAM_TEXT_BYTES = 256 * 1024;

function eventText(value: unknown, label: string, maxBytes = 2048): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label} in engine event.`);
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) return value;
  let low = 0;
  let high = Math.min(value.length, maxBytes);
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, midpoint), 'utf-8') <= maxBytes) low = midpoint;
    else high = midpoint - 1;
  }
  return `${value.slice(0, low)}\n[Streaming event truncated.]`;
}

function eventRound(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1000) {
    throw new Error('Invalid round in engine event.');
  }
  return value;
}

export function toRendererProvenance(
  provenance: SourceProvenance
): RendererSourceProvenance {
  return provenance.mode === 'source'
    ? {
        mode: provenance.mode,
        roomId: provenance.roomId,
        sourceId: provenance.sourceId,
        sourceName: provenance.sourceName,
        startedAt: provenance.startedAt
      }
    : { ...provenance };
}

function toRendererMessage(message: DiscussionMessage): RendererMessage {
  const {
    id, type, agentName, providerName, modelName, content, timestamp,
    round, references, contextMessages, contextMetrics
  } = message;
  return {
    id, type, agentName, providerName, modelName, content, timestamp,
    round, references, contextMessages, contextMetrics
  };
}

export function toRendererDiscussionLog(log: DiscussionLog): RendererDiscussionLog {
  return {
    id: log.id,
    title: log.title,
    topic: log.topic,
    status: log.status,
    messages: log.messages.map(toRendererMessage),
    sourceProvenance: toRendererProvenance(log.sourceProvenance)
  };
}

export function toRendererTaskResult(result: CodingTaskResult): RendererTaskResult {
  return {
    id: result.id,
    title: result.title,
    task: result.task,
    taskType: result.taskType,
    status: result.status,
    cycles: result.cycles,
    messages: result.messages.map(toRendererMessage),
    markdownFilename: result.markdownFilename,
    jsonFilename: result.jsonFilename,
    artifactFilename: result.artifactFilename,
    approvedBy: result.approvedBy,
    statusSummary: result.statusSummary,
    associatedCardId: result.associatedCardId,
    continuedFromTaskId: result.continuedFromTaskId,
    sourceProvenance: toRendererProvenance(result.sourceProvenance)
  };
}

export function parseRendererProvenance(value: unknown): RendererSourceProvenance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const provenance = value as Record<string, unknown>;
  if (
    provenance.mode === 'room-only'
    && typeof provenance.roomId === 'string'
    && typeof provenance.startedAt === 'string'
  ) {
    return {
      mode: 'room-only',
      roomId: provenance.roomId,
      startedAt: provenance.startedAt
    };
  }
  if (
    provenance.mode === 'source'
    && typeof provenance.roomId === 'string'
    && typeof provenance.sourceId === 'string'
    && typeof provenance.sourceName === 'string'
    && typeof provenance.startedAt === 'string'
  ) {
    return {
      mode: 'source',
      roomId: provenance.roomId,
      sourceId: provenance.sourceId,
      sourceName: provenance.sourceName,
      startedAt: provenance.startedAt
    };
  }
  return undefined;
}

interface RunEventSender {
  isDestroyed(): boolean;
  send(channel: string, payload: DiscussionIpcEvent): void;
}

/**
 * Emits run events to a renderer that may already be gone. A closed window must
 * never abort engine work or stop a run from persisting a terminal status, so
 * delivery failure is dropped rather than thrown back into the run.
 */
export function createRunEventSender(
  sender: RunEventSender
): (payload: EngineRendererEvent) => void {
  return (payload: EngineRendererEvent) => {
    const rendererEvent = toRendererEvent(payload);
    if (!rendererEvent || sender.isDestroyed()) return;
    try {
      sender.send('discussion-event', rendererEvent);
    } catch {
      // The renderer went away between the check and the send.
    }
  };
}

export function toRendererEvent(
  payload: EngineRendererEvent
): DiscussionIpcEvent | null {
  const discussionId = eventText(payload.discussionId, 'discussion id', 256);
  switch (payload.type) {
    case 'discussion_started':
      return {
        type: 'discussion_started',
        discussionId,
        title: eventText(payload.title, 'discussion title', 2048)
      };
    case 'agent_started':
      return {
        type: 'agent_started',
        discussionId,
        agentName: eventText(payload.agentName, 'agent name', 512),
        providerName: eventText(payload.providerName, 'provider name', 512),
        ...(payload.modelName ? { modelName: eventText(payload.modelName, 'model name', 512) } : {}),
        role: eventText(payload.role, 'agent role', 1024),
        round: eventRound(payload.round),
        timestamp: eventText(payload.timestamp, 'timestamp', 128)
      };
    case 'agent_chunk':
      return {
        type: 'agent_chunk',
        discussionId,
        agentName: eventText(payload.agentName, 'agent name', 512),
        providerName: eventText(payload.providerName, 'provider name', 512),
        ...(payload.modelName ? { modelName: eventText(payload.modelName, 'model name', 512) } : {}),
        round: eventRound(payload.round),
        chunk: eventText(payload.chunk, 'agent chunk', STREAM_TEXT_BYTES)
      };
    case 'message_completed': {
      if (!payload.message) throw new Error('Invalid message in engine event.');
      const message = toRendererMessage(payload.message);
      return {
        type: 'message_completed',
        discussionId,
        round: eventRound(payload.round),
        message: {
          ...message,
          content: eventText(message.content, 'message content', STREAM_TEXT_BYTES)
        }
      };
    }
    case 'agent_error':
      return {
        type: 'agent_error',
        discussionId,
        agentName: eventText(payload.agentName, 'agent name', 512),
        providerName: eventText(payload.providerName, 'provider name', 512),
        ...(payload.modelName ? { modelName: eventText(payload.modelName, 'model name', 512) } : {}),
        round: eventRound(payload.round),
        error: 'AI member failed to respond.'
      };
    case 'discussion_completed':
      return { type: 'discussion_completed', discussionId };
    case 'discussion_interrupted': {
      if (!payload.message) throw new Error('Invalid interrupt message in engine event.');
      return {
        type: 'discussion_interrupted',
        discussionId,
        message: {
          ...toRendererMessage(payload.message),
          content: eventText(payload.message.content, 'interrupt message', STREAM_TEXT_BYTES)
        },
        reason: eventText(payload.reason || '', 'interrupt reason', STREAM_TEXT_BYTES)
      };
    }
    case 'discussion_failed':
      return {
        type: 'discussion_failed',
        discussionId,
        error: 'ROOM could not complete this run.'
      };
    case 'context_summary_failed':
      return {
        type: 'context_summary_failed',
        discussionId,
        round: eventRound(payload.round),
        ...(payload.error ? { error: 'ROOM could not summarize this context.' } : {})
      };
    case 'context_summary_generated':
    case 'context_summary_reused':
      return {
        type: payload.type,
        discussionId,
        round: eventRound(payload.round)
      };
    default:
      return null;
  }
}
