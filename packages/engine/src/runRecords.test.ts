import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeRecordedRun } from './runRecords.js';
import type { WorkspaceLocation } from './workspace.js';

const roots: string[] = [];

async function workspace(source = false): Promise<WorkspaceLocation> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-run-record-'));
  roots.push(root);
  const roomRoot = path.join(root, 'room');
  await fs.mkdir(roomRoot);
  if (!source) return { roomId: 'room_test', roomRoot };
  const sourceRoot = path.join(root, 'source');
  await fs.mkdir(sourceRoot);
  return {
    roomId: 'room_test',
    roomRoot,
    sourceId: 'source_11111111111111111111111111111111',
    sourceName: 'Source',
    sourceRoot
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('run records', () => {
  it('persists source-less provenance before and after a successful run', async () => {
    const location = await workspace();
    await executeRecordedRun(location, 'discussion', 'discussion-1', async provenance => {
      const files = (await fs.readdir(path.join(location.roomRoot, 'runs')))
        .filter(file => file.endsWith('.json'));
      const running = JSON.parse(await fs.readFile(path.join(location.roomRoot, 'runs', files[0]), 'utf-8'));
      expect(running).toMatchObject({
        kind: 'discussion',
        status: 'running',
        subjectId: 'discussion-1',
        sourceProvenance: provenance
      });
      return 'done';
    });

    const [filename] = (await fs.readdir(path.join(location.roomRoot, 'runs')))
      .filter(file => file.endsWith('.json'));
    const completed = JSON.parse(await fs.readFile(
      path.join(location.roomRoot, 'runs', filename),
      'utf-8'
    ));
    expect(completed).toMatchObject({
      status: 'completed',
      sourceProvenance: { mode: 'room-only', roomId: 'room_test' }
    });
  });

  it('keeps the initial Source snapshot and records failures', async () => {
    const location = await workspace(true);
    const sentinel = 'provider-private-run-record-sentinel';
    await expect(executeRecordedRun(location, 'scan', location.sourceId, async provenance => {
      expect(provenance).toMatchObject({
        mode: 'source',
        sourceId: location.sourceId
      });
      throw new Error(sentinel);
    })).rejects.toThrow(sentinel);

    const [filename] = (await fs.readdir(path.join(location.roomRoot, 'runs')))
      .filter(file => file.endsWith('.json'));
    const failed = JSON.parse(await fs.readFile(
      path.join(location.roomRoot, 'runs', filename),
      'utf-8'
    ));
    expect(failed).toMatchObject({
      kind: 'scan',
      status: 'failed',
      error: 'Run failed.',
      sourceProvenance: {
        mode: 'source',
        roomId: 'room_test',
        sourceId: location.sourceId
      }
    });
    expect(JSON.stringify(failed)).not.toContain(sentinel);
  });

  it('serializes concurrent runs for the same Room subject', async () => {
    const location = await workspace();
    let active = 0;
    let maximumActive = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      signalStarted = resolve;
    });
    const first = executeRecordedRun(location, 'task', 'task-shared', async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      signalStarted();
      await firstGate;
      active -= 1;
    });
    await started;
    const second = executeRecordedRun(location, 'task', 'task-shared', async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(maximumActive).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(maximumActive).toBe(1);
  });

  it('records a continued task child while locking on its parent', async () => {
    const location = await workspace();
    await executeRecordedRun(
      location,
      'task',
      'task-child',
      async () => undefined,
      'task-parent',
      [{
        roomId: 'room_test',
        referenceKind: 'member',
        id: 'mem_doer',
        name: 'Doer',
        role: 'Doer',
        provider: 'Gemini',
        configurationDigest: 'a'.repeat(64),
        skillSnapshotDigest: 'b'.repeat(64)
      }]
    );

    const [filename] = await fs.readdir(path.join(location.roomRoot, 'runs'));
    const record = JSON.parse(await fs.readFile(
      path.join(location.roomRoot, 'runs', filename),
      'utf-8'
    ));
    expect(record).toMatchObject({
      kind: 'task',
      subjectId: 'task-child',
      status: 'completed',
      participants: [{ roomId: 'room_test', id: 'mem_doer' }]
    });
  });

  it('serializes discussion-derived operations under the discussion subject lock', async () => {
    const location = await workspace();
    let active = 0;
    let maximumActive = 0;
    let releaseModeration!: () => void;
    const moderationGate = new Promise<void>(resolve => {
      releaseModeration = resolve;
    });
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      signalStarted = resolve;
    });
    const moderation = executeRecordedRun(location, 'moderation', 'discussion-shared', async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      signalStarted();
      await moderationGate;
      active -= 1;
    });
    await started;
    const continuation = executeRecordedRun(location, 'discussion', 'discussion-shared', async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(maximumActive).toBe(1);
    releaseModeration();
    await Promise.all([moderation, continuation]);
    expect(maximumActive).toBe(1);
  });
});
