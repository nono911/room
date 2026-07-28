import { randomUUID } from 'crypto';

const DISCUSSION_ID_PATTERN = /^discussion-[A-Za-z0-9_-]+$/;
const TASK_ID_PATTERN = /^task-[A-Za-z0-9_-]+$/;
export const RUN_ID_MAX_BYTES = 160;

export function createDiscussionRunId(now = Date.now()): string {
  return `discussion-${now}-${randomUUID().replaceAll('-', '')}`;
}

export function isDiscussionRunId(value: unknown): value is string {
  return isBoundedRunId(value, DISCUSSION_ID_PATTERN);
}

export function isTaskRunId(value: unknown): value is string {
  return isBoundedRunId(value, TASK_ID_PATTERN);
}

export function isControlledRunId(value: unknown): value is string {
  return isDiscussionRunId(value) || isTaskRunId(value);
}

function isBoundedRunId(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf-8') <= RUN_ID_MAX_BYTES
    && pattern.test(value);
}
