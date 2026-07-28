import { randomUUID } from 'crypto';

export function createTaskRunId(now = Date.now()): string {
  return `task-${now}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
