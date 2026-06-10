import { describe, expect, it } from 'vitest';
import {
  createContextSummaryCache,
  hashSummaryInput,
  isReusableContextSummaryCache,
  sameOrderedIndexes,
  validateContextSummaryId
} from './contextSummaryCache.js';

const messages = [
  { type: 'user' as const, agentName: 'You', providerName: 'User', content: 'topic', timestamp: '10:00' },
  { type: 'agent' as const, agentName: 'A', providerName: 'Local CLI', content: 'first answer', timestamp: '10:01' },
  { type: 'agent' as const, agentName: 'B', providerName: 'Local CLI', content: 'second answer', timestamp: '10:02' }
];

describe('contextSummaryCache', () => {
  it('reuses cache only for an exact candidate index set and matching hash', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-123', messages, [1, 2], 'summary');

    expect(isReusableContextSummaryCache(cache, messages, [1, 2])).toBe(true);
    expect(isReusableContextSummaryCache(cache, messages, [1])).toBe(false);
    expect(isReusableContextSummaryCache(cache, messages, [1, 2, 3])).toBe(false);
    expect(isReusableContextSummaryCache(cache, messages, [2, 1])).toBe(false);
  });

  it('invalidates cache when summarized message content changes', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-123', messages, [1], 'summary');
    const changedMessages = [
      messages[0],
      { ...messages[1], content: 'changed answer' },
      messages[2]
    ];

    expect(cache.summaryInputHash).toBe(hashSummaryInput(messages, [1]));
    expect(isReusableContextSummaryCache(cache, changedMessages, [1])).toBe(false);
  });

  it('validates sidecar ids by source', () => {
    expect(() => validateContextSummaryId('discussion', 'discussion-123')).not.toThrow();
    expect(() => validateContextSummaryId('coding-task', 'task-123')).not.toThrow();
    expect(() => validateContextSummaryId('discussion', '../discussion-123')).toThrow();
    expect(() => validateContextSummaryId('coding-task', 'discussion-123')).toThrow();
  });

  it('compares exact ordered index sets', () => {
    expect(sameOrderedIndexes([1, 2], [1, 2])).toBe(true);
    expect(sameOrderedIndexes([1, 2], [2, 1])).toBe(false);
  });
});
