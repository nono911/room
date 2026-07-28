import { describe, expect, it } from 'vitest';
import {
  createDiscussionRunId,
  isControlledRunId,
  isDiscussionRunId,
  isTaskRunId,
  RUN_ID_MAX_BYTES
} from './runId.js';

describe('discussion run IDs', () => {
  it('creates unique IDs even with a fixed timestamp', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createDiscussionRunId(1234)));
    expect(ids.size).toBe(100);
    expect([...ids].every(isDiscussionRunId)).toBe(true);
  });

  it('rejects traversal and malformed values', () => {
    expect(isDiscussionRunId('discussion-safe_123')).toBe(true);
    expect(isTaskRunId('task-safe_123')).toBe(true);
    expect(isControlledRunId('task-safe_123')).toBe(true);
    expect(isDiscussionRunId('../discussion-123')).toBe(false);
    expect(isDiscussionRunId('discussion-a/b')).toBe(false);
    expect(isDiscussionRunId(`discussion-${'a'.repeat(RUN_ID_MAX_BYTES)}`)).toBe(false);
    expect(isTaskRunId(`task-${'a'.repeat(RUN_ID_MAX_BYTES)}`)).toBe(false);
  });
});
