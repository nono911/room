import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

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

const ensuredDirs = new Set<string>();

async function ensureEventsDir(eventsPath: string): Promise<void> {
  const dir = path.dirname(eventsPath);
  if (ensuredDirs.has(dir)) return;
  await fs.mkdir(dir, { recursive: true });
  ensuredDirs.add(dir);
}

export async function appendRoomEvents(dirPath: string, inputs: NewRoomEvent[]): Promise<RoomEvent[]> {
  if (inputs.length === 0) return [];
  const events = inputs.map(createRoomEvent);
  const eventsPath = path.join(dirPath, '.room', 'events.jsonl');
  await ensureEventsDir(eventsPath);
  await fs.appendFile(eventsPath, `${events.map(event => JSON.stringify(event)).join('\n')}\n`, 'utf-8');
  return events;
}

export async function appendRoomEvent(dirPath: string, input: NewRoomEvent): Promise<RoomEvent> {
  const [event] = await appendRoomEvents(dirPath, [input]);
  return event;
}
