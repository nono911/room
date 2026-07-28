// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createRunEventSender } from '../../main/ipc/renderer-safe.js';

const startedEvent = {
  type: 'discussion_started',
  discussionId: 'task-abc',
  title: 'Ship the migration'
};

describe('run event delivery to a closing renderer', () => {
  it('drops events once the renderer is destroyed', () => {
    const send = vi.fn();
    const emit = createRunEventSender({ isDestroyed: () => true, send });

    expect(() => emit(startedEvent)).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('never throws into the run when the renderer dies mid-send', () => {
    const send = vi.fn(() => {
      throw new Error('Object has been destroyed');
    });
    const emit = createRunEventSender({ isDestroyed: () => false, send });

    // A throw here would abort the engine loop before it persists a terminal
    // status, leaving the transcript pinned at "active".
    expect(() => emit(startedEvent)).not.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });

  it('still delivers to a live renderer', () => {
    const send = vi.fn();
    const emit = createRunEventSender({ isDestroyed: () => false, send });

    emit(startedEvent);

    expect(send).toHaveBeenCalledWith('discussion-event', {
      type: 'discussion_started',
      discussionId: 'task-abc',
      title: 'Ship the migration'
    });
  });

  it('surfaces malformed engine events instead of silently dropping them', () => {
    const emit = createRunEventSender({ isDestroyed: () => false, send: vi.fn() });

    expect(() => emit({ type: 'message_completed', discussionId: 'task-abc' }))
      .toThrow();
  });
});
