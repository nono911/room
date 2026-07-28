export function normalizeTaskType(value: unknown): string {
  if (value === undefined) return 'general';
  if (typeof value !== 'string') throw new Error('Invalid task type.');
  return value.trim().toLowerCase() || 'general';
}
