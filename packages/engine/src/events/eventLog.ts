import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';
import { appendRoomTextFile, withRoomStorageReconciliation } from '../roomFile.js';

export interface RoomEventEndpoint {
  type: string;
  id: string;
}

export interface RoomEvent {
  v: 1;
  id: string;
  type: string;
  at: string;
  actor?: string;
  source?: RoomEventEndpoint;
  target?: RoomEventEndpoint;
  data?: Record<string, unknown>;
}

export type NewRoomEvent = Omit<RoomEvent, 'v' | 'id' | 'at'> & {
  id?: string;
  at?: string;
};

export function createRoomEvent(input: NewRoomEvent): RoomEvent {
  return {
    v: 1,
    id: input.id || `evt-${Date.now().toString(36)}-${randomUUID()}`,
    type: input.type,
    at: input.at || new Date().toISOString(),
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.data ? { data: input.data } : {})
  };
}

// Nothing in engine, main, or renderer reads events.jsonl today. Its appends
// (appendRoomTextFile -> fs.appendFile) are not atomic, so a crash mid-append
// can leave a torn trailing line — a future reader must tolerate and skip an
// unparseable final line rather than failing the whole read. That is a
// deliberate constraint on this format, not an oversight to redesign around.

const EVENTS_LOG_ROTATE_BYTES = 8 * 1024 * 1024;

const ensuredDirs = new Set<string>();

async function ensureEventsDir(eventsPath: string): Promise<void> {
  const dir = path.dirname(eventsPath);
  if (ensuredDirs.has(dir)) return;
  await fs.mkdir(dir, { recursive: true });
  ensuredDirs.add(dir);
}

// Unbounded growth is otherwise checked only by the 256MiB Room quota, at
// which point *unrelated* writes start failing. Nothing reads this file yet,
// so it only needs to stay bounded, not queryable: one rotation is enough.
async function rotateEventsLogIfNeeded(
  workspace: WorkspaceInput,
  eventsPath: string
): Promise<void> {
  const stat = await fs.stat(eventsPath).catch((error: unknown) => {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  });
  if (!stat || stat.size < EVENTS_LOG_ROTATE_BYTES) return;
  await withRoomStorageReconciliation(workspace, async () => {
    await fs.rm(`${eventsPath}.1`, { force: true });
    await fs.rename(eventsPath, `${eventsPath}.1`);
  });
}

export async function appendRoomEvents(workspace: WorkspaceInput, inputs: NewRoomEvent[]): Promise<RoomEvent[]> {
  if (inputs.length === 0) return [];
  const events = inputs.map(createRoomEvent);
  const eventsPath = resolveRoomPath(workspace, 'events.jsonl');
  const payload = `${events.map(event => JSON.stringify(event)).join('\n')}\n`;
  await ensureEventsDir(eventsPath);
  await rotateEventsLogIfNeeded(workspace, eventsPath);
  try {
    await appendRoomTextFile(workspace, ['events.jsonl'], payload);
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    // The Room directory can be removed at runtime after this directory was
    // last ensured; the cache does not otherwise invalidate. Reset it and
    // retry once instead of failing every append forever.
    ensuredDirs.delete(path.dirname(eventsPath));
    await ensureEventsDir(eventsPath);
    await appendRoomTextFile(workspace, ['events.jsonl'], payload);
  }
  return events;
}

export async function appendRoomEvent(workspace: WorkspaceInput, input: NewRoomEvent): Promise<RoomEvent> {
  const [event] = await appendRoomEvents(workspace, [input]);
  return event;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
