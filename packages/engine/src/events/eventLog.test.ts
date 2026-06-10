import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { appendRoomEvent, appendRoomEvents } from './eventLog.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-events-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('appendRoomEvent', () => {
  it('appends versioned JSONL events under .room', async () => {
    const event = await appendRoomEvent(dir, {
      type: 'message.created',
      source: { type: 'discussion', id: 'discussion-1' },
      target: { type: 'message', id: 'discussion-1:message-0001' }
    });

    const content = await fs.readFile(path.join(dir, '.room', 'events.jsonl'), 'utf-8');
    const line = JSON.parse(content.trim());
    expect(line).toEqual(event);
    expect(line.v).toBe(1);
    expect(line.id).toMatch(/^evt-/);
    expect(line.type).toBe('message.created');
  });

  it('appends a batch of events as one line per event', async () => {
    const events = await appendRoomEvents(dir, [
      { type: 'task.created', target: { type: 'task', id: 'card-001' } },
      { type: 'adr.created', target: { type: 'adr', id: 'adr-001' } }
    ]);

    expect(events).toHaveLength(2);
    const content = await fs.readFile(path.join(dir, '.room', 'events.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toEqual(events);
  });

  it('writes nothing for an empty batch', async () => {
    const events = await appendRoomEvents(dir, []);
    expect(events).toEqual([]);
    await expect(fs.readFile(path.join(dir, '.room', 'events.jsonl'), 'utf-8')).rejects.toThrow();
  });
});
