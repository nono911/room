import type { RoomSource } from '@room/engine';

const MAX_PENDING_SOURCE_OPERATIONS = 4;
const sourceOperationQueues = new Map<string, Promise<void>>();
const sourceOperationDepth = new Map<string, number>();

export async function withSourceOperationQueue<T>(
  source: RoomSource,
  operation: () => Promise<T>
): Promise<T> {
  const key = source.id;
  const depth = sourceOperationDepth.get(key) || 0;
  if (depth >= MAX_PENDING_SOURCE_OPERATIONS) {
    throw new Error('Too many pending operations for this Source. Try again shortly.');
  }
  sourceOperationDepth.set(key, depth + 1);
  const previous = sourceOperationQueues.get(key) || Promise.resolve();
  let release = (): void => {};
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  sourceOperationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    const remaining = (sourceOperationDepth.get(key) || 1) - 1;
    if (remaining === 0) sourceOperationDepth.delete(key);
    else sourceOperationDepth.set(key, remaining);
    if (sourceOperationQueues.get(key) === queued) sourceOperationQueues.delete(key);
  }
}
