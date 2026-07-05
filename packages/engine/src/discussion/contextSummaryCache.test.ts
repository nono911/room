import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  checkContextSummaryCacheReuse,
  contextSummaryCachePath,
  createContextSummaryCache,
  hashSummaryInput,
  isReusableContextSummaryCache,
  readContextSummaryCache,
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
    expect(() => validateContextSummaryId('discussion', 'discussion-design-review')).not.toThrow();
    expect(() => validateContextSummaryId('coding-task', 'task-123')).not.toThrow();
    expect(() => validateContextSummaryId('coding-task', 'task-card-001')).not.toThrow();
    expect(() => validateContextSummaryId('discussion', '../discussion-123')).toThrow();
    expect(() => validateContextSummaryId('coding-task', 'discussion-123')).toThrow();
  });

  it('compares exact ordered index sets', () => {
    expect(sameOrderedIndexes([1, 2], [1, 2])).toBe(true);
    expect(sameOrderedIndexes([1, 2], [2, 1])).toBe(false);
  });

  it('treats corrupted cache JSON as a cache miss', async () => {
    const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'room-cache-'));
    const input = { dirPath, source: 'discussion' as const, contextId: 'discussion-123' };
    await fs.mkdir(path.dirname(contextSummaryCachePath(input)), { recursive: true });
    await fs.writeFile(contextSummaryCachePath(input), '{ broken json', 'utf-8');

    await expect(readContextSummaryCache(input)).resolves.toBeNull();
    await fs.rm(dirPath, { recursive: true, force: true });
  });
});

function cacheMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `discussion-1:message-${String(index + 1).padStart(4, '0')}`,
    type: 'agent' as const,
    agentName: `Agent ${index}`,
    providerName: 'Claude',
    content: `content ${index}`,
    timestamp: '10:00'
  }));
}

describe('checkContextSummaryCacheReuse', () => {
  const cacheReuseMessages = cacheMessages(10);

  it('reports exact reuse when candidates match the cache', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', cacheReuseMessages, [1, 2, 3], 'sum');
    expect(checkContextSummaryCacheReuse(cache, cacheReuseMessages, [1, 2, 3]))
      .toEqual({ exact: true, prefix: true, uncoveredIndexes: [] });
  });

  it('reports prefix reuse with the uncovered tail', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', cacheReuseMessages, [1, 2, 3], 'sum');
    expect(checkContextSummaryCacheReuse(cache, cacheReuseMessages, [1, 2, 3, 4, 5]))
      .toEqual({ exact: false, prefix: true, uncoveredIndexes: [4, 5] });
  });

  it('rejects non-prefix candidate sets', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', cacheReuseMessages, [1, 2, 3], 'sum');
    expect(checkContextSummaryCacheReuse(cache, cacheReuseMessages, [2, 3, 4]).prefix).toBe(false);
  });

  it('rejects when covered message content changed', () => {
    const cache = createContextSummaryCache('discussion', 'discussion-1', cacheReuseMessages, [1, 2, 3], 'sum');
    const mutated = cacheMessages(10);
    mutated[2] = { ...mutated[2], content: 'edited' };
    expect(checkContextSummaryCacheReuse(cache, mutated, [1, 2, 3, 4]).prefix).toBe(false);
  });

  it('rejects a null cache', () => {
    expect(checkContextSummaryCacheReuse(null, cacheReuseMessages, [1, 2]))
      .toEqual({ exact: false, prefix: false, uncoveredIndexes: [1, 2] });
  });
});
