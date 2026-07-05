import { describe, expect, it } from 'vitest';
import { appendContextSummaryFailedMessage } from './streaming.js';
import type { UIMessage } from '../../types/domain.js';

describe('appendContextSummaryFailedMessage', () => {
  it('appends a system message with a stable id and the error detail', () => {
    const prev: UIMessage[] = [];
    const next = appendContextSummaryFailedMessage(prev, { discussionId: 'disc-1', error: 'timeout' });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: 'disc-1:context-summary-failed',
      author: 'System Engine',
      role: 'system'
    });
    expect(next[0].text).toContain('Context summarization failed');
    expect(next[0].text).toContain('timeout');
  });

  it('omits the error detail when none is provided', () => {
    const next = appendContextSummaryFailedMessage([], { discussionId: 'disc-1' });
    expect(next[0].text).toBe('Context summarization failed — agents may be missing older discussion context.');
  });

  it('does not append a duplicate message for the same discussion', () => {
    const first = appendContextSummaryFailedMessage([], { discussionId: 'disc-1', error: 'timeout' });
    const second = appendContextSummaryFailedMessage(first, { discussionId: 'disc-1', error: 'timeout' });

    expect(second).toBe(first);
    expect(second).toHaveLength(1);
  });

  it('appends separately for a different discussion id', () => {
    const first = appendContextSummaryFailedMessage([], { discussionId: 'disc-1' });
    const second = appendContextSummaryFailedMessage(first, { discussionId: 'disc-2' });

    expect(second).toHaveLength(2);
  });
});
