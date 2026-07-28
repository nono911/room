// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { normalizeTaskType } from '../../main/ipc/task-type.js';
import { createTaskRunId } from '../../main/ipc/task-run-id.js';

describe('task type IPC normalization', () => {
  it.each([
    ['coding', 'coding'],
    [' Coding ', 'coding'],
    ['CODING', 'coding'],
    [undefined, 'general'],
    ['', 'general']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeTaskType(input)).toBe(expected);
  });

  it('rejects non-string task types', () => {
    expect(() => normalizeTaskType({ type: 'coding' })).toThrow('Invalid task type');
  });

  it('creates a unique run identity independent of a task-card identity', () => {
    const first = createTaskRunId(123);
    const second = createTaskRunId(123);
    expect(first).toMatch(/^task-123-[a-f0-9]{12}$/);
    expect(second).not.toBe(first);
  });
});
