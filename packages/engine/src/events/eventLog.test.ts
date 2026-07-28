import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { appendRoomEvent, appendRoomEvents } from './eventLog.js';
import { testWorkspace } from '../testWorkspace.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-events-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('appendRoomEvent', () => {
  it('appends versioned JSONL events under .room', async () => {
    const event = await appendRoomEvent(testWorkspace(dir), {
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
    const events = await appendRoomEvents(testWorkspace(dir), [
      { type: 'task.created', target: { type: 'task', id: 'card-001' } },
      { type: 'adr.created', target: { type: 'adr', id: 'adr-001' } }
    ]);

    expect(events).toHaveLength(2);
    const content = await fs.readFile(path.join(dir, '.room', 'events.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toEqual(events);
  });

  it('writes nothing for an empty batch', async () => {
    const events = await appendRoomEvents(testWorkspace(dir), []);
    expect(events).toEqual([]);
    await expect(fs.readFile(path.join(dir, '.room', 'events.jsonl'), 'utf-8')).rejects.toThrow();
  });

  it('recovers after the Room directory is removed at runtime instead of failing every append forever', async () => {
    const workspace = testWorkspace(dir);
    await appendRoomEvent(workspace, { type: 'first' });
    // The directory-ensured cache is keyed by path and never otherwise
    // invalidates; removing the directory out from under it must not leave
    // future appends stuck believing it still exists.
    await fs.rm(path.join(dir, '.room'), { recursive: true, force: true });

    const event = await appendRoomEvent(workspace, { type: 'second' });

    const content = await fs.readFile(path.join(dir, '.room', 'events.jsonl'), 'utf-8');
    expect(JSON.parse(content.trim())).toEqual(event);
  });

  it('rotates events.jsonl instead of letting it grow without bound', async () => {
    const workspace = testWorkspace(dir);
    // Seed a large existing log directly — writing enough real events through
    // the public API to cross the rotation threshold would be slow, and
    // rotation only cares about the file's size on disk.
    await fs.mkdir(path.join(dir, '.room'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.room', 'events.jsonl'),
      'x'.repeat(9 * 1024 * 1024)
    );

    const event = await appendRoomEvent(workspace, { type: 'triggers-rotation' });

    const rotatedStat = await fs.stat(path.join(dir, '.room', 'events.jsonl.1'));
    expect(rotatedStat.size).toBeGreaterThanOrEqual(9 * 1024 * 1024);
    const current = await fs.readFile(path.join(dir, '.room', 'events.jsonl'), 'utf-8');
    expect(JSON.parse(current.trim())).toEqual(event);
  });

  it('keeps only one rotated generation instead of accumulating them', async () => {
    const workspace = testWorkspace(dir);
    await fs.mkdir(path.join(dir, '.room'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.room', 'events.jsonl.1'),
      'stale-generation'
    );
    await fs.writeFile(
      path.join(dir, '.room', 'events.jsonl'),
      'x'.repeat(9 * 1024 * 1024)
    );

    await appendRoomEvent(workspace, { type: 'triggers-rotation' });

    const rotated = await fs.readFile(path.join(dir, '.room', 'events.jsonl.1'), 'utf-8');
    expect(rotated).not.toBe('stale-generation');
    expect(rotated.length).toBeGreaterThanOrEqual(9 * 1024 * 1024);
  });
});
