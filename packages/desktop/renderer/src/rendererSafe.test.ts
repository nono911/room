// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  parseRendererProvenance,
  toRendererEvent,
  toRendererProvenance
} from '../../main/ipc/renderer-safe.js';

describe('renderer-safe IPC DTOs', () => {
  it('removes filesystem authority while retaining Room and Source IDs', () => {
    expect(toRendererProvenance({
      mode: 'source',
      roomId: 'room_personal',
      sourceId: 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceName: 'Source',
      startedAt: '2026-01-01T00:00:00.000Z'
    })).toEqual({
      mode: 'source',
      roomId: 'room_personal',
      sourceId: 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceName: 'Source',
      startedAt: '2026-01-01T00:00:00.000Z'
    });
  });

  it('parses persisted provenance into an explicit renderer DTO', () => {
    expect(parseRendererProvenance({
      mode: 'source',
      roomId: 'room_personal',
      sourceId: 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceName: 'Source',
      sourceCanonicalPath: '/private/source',
      startedAt: '2026-01-01T00:00:00.000Z',
      unexpected: '/private/other'
    })).toEqual({
      mode: 'source',
      roomId: 'room_personal',
      sourceId: 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceName: 'Source',
      startedAt: '2026-01-01T00:00:00.000Z'
    });
  });

  it('constructs streaming events from the discriminated renderer contract', () => {
    expect(toRendererEvent({
      type: 'agent_started',
      discussionId: 'discussion-1',
      agentName: 'Reviewer',
      providerName: 'gemini',
      role: 'Reviewer',
      round: 1,
      timestamp: '2026-01-01T00:00:00.000Z'
    })).toEqual({
      type: 'agent_started',
      discussionId: 'discussion-1',
      agentName: 'Reviewer',
      providerName: 'gemini',
      role: 'Reviewer',
      round: 1,
      timestamp: '2026-01-01T00:00:00.000Z'
    });
    expect(toRendererEvent({
      type: 'future_event',
      discussionId: 'discussion-1'
    })).toBeNull();
  });

  it('maps engine fault details to stable renderer-safe messages', () => {
    const event = toRendererEvent({
      type: 'discussion_failed',
      discussionId: 'discussion-1',
      error: 'EACCES: /Users/person/.room/rooms/room_personal/private.json'
    });

    expect(event).toEqual({
      type: 'discussion_failed',
      discussionId: 'discussion-1',
      error: 'ROOM could not complete this run.'
    });
    expect(JSON.stringify(event)).not.toContain('/Users/person');
  });
});
