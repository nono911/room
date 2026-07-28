import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileAbandonedRunRecords } from './runRecovery.js';
import { currentProcessIdentity } from './processLease.js';
import type { RoomRecord } from './roomHome.js';

const roots: string[] = [];

async function roomRecord(): Promise<RoomRecord> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-run-recovery-'));
  roots.push(root);
  const roomRoot = path.join(root, 'room');
  await fs.mkdir(path.join(roomRoot, 'runs'), { recursive: true });
  return {
    roomRoot,
    manifest: {
      schemaVersion: 1,
      id: 'room_personal',
      name: 'Personal Room',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
      sources: []
    }
  } as RoomRecord;
}

async function writeRun(
  record: RoomRecord,
  index: number,
  status: 'running' | 'completed',
  startedAt: string
): Promise<string> {
  const id = `run_${index.toString(16).padStart(32, '0')}`;
  await fs.writeFile(
    path.join(record.roomRoot, 'runs', `${id}.json`),
    JSON.stringify({
      id,
      kind: 'discussion',
      status,
      attemptId: '00000000-4000-8000-8000-000000000000',
      ownerPid: 999_999,
      ownerProcessIdentity: 'gone',
      sourceProvenance: { mode: 'room-only', startedAt },
      startedAt,
      ...(status === 'completed' ? { completedAt: startedAt } : {})
    }, null, 2)
  );
  return `${id}.json`;
}

async function runFiles(record: RoomRecord): Promise<string[]> {
  return (await fs.readdir(path.join(record.roomRoot, 'runs')))
    .filter(name => name.endsWith('.json'));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('abandoned run reconciliation', () => {
  it('opens the Room instead of failing when run records exceed the listing limit', async () => {
    const record = await roomRecord();
    for (let index = 0; index < 6; index += 1) {
      await writeRun(record, index, 'completed', `2026-01-0${index + 1}T00:00:00.000Z`);
    }

    // A Room must never become unopenable because it accumulated history.
    await expect(reconcileAbandonedRunRecords(record, { limit: 3, retention: 100 }))
      .resolves.toBeUndefined();
  });

  it('marks an abandoned running record interrupted', async () => {
    const record = await roomRecord();
    const filename = await writeRun(record, 1, 'running', '2026-01-01T00:00:00.000Z');

    await reconcileAbandonedRunRecords(record);

    const reconciled = JSON.parse(await fs.readFile(
      path.join(record.roomRoot, 'runs', filename),
      'utf-8'
    ));
    expect(reconciled.status).toBe('interrupted');
    expect(reconciled.completedAt).toBeTruthy();
  });

  it('prunes the oldest finished records down to the retention cap', async () => {
    const record = await roomRecord();
    for (let index = 0; index < 5; index += 1) {
      await writeRun(record, index, 'completed', `2026-01-0${index + 1}T00:00:00.000Z`);
    }
    const survivor = await writeRun(record, 9, 'running', '2026-01-09T00:00:00.000Z');

    await reconcileAbandonedRunRecords(record, { retention: 2 });

    const remaining = await runFiles(record);
    // Just-reconciled records are retained ahead of older finished ones.
    expect(remaining).toContain(survivor);
    expect(remaining).toHaveLength(3);
    const startedAts = await Promise.all(remaining.map(async name => JSON.parse(
      await fs.readFile(path.join(record.roomRoot, 'runs', name), 'utf-8')
    ).startedAt as string));
    expect(startedAts.sort()).toEqual([
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
      '2026-01-09T00:00:00.000Z'
    ]);
  });

  it('reclaims an orphaned attempt lease that no run record claims', async () => {
    // A crash between lease creation and the run record write (or between the
    // terminal record write and lease release) leaves a `.attempt-*.lease`
    // file with nothing else to reclaim it.
    const record = await roomRecord();
    const leasePath = path.join(
      record.roomRoot,
      'runs',
      '.attempt-11111111-1111-4111-8111-111111111111.lease'
    );
    await fs.writeFile(leasePath, JSON.stringify({
      attemptId: '11111111-1111-4111-8111-111111111111',
      pid: 999_999,
      processIdentity: 'gone'
    }));

    await reconcileAbandonedRunRecords(record);

    await expect(fs.access(leasePath)).rejects.toThrow();
  });

  it('keeps an orphaned-looking attempt lease that a live process still holds', async () => {
    const record = await roomRecord();
    const leasePath = path.join(
      record.roomRoot,
      'runs',
      '.attempt-22222222-2222-4222-8222-222222222222.lease'
    );
    await fs.writeFile(leasePath, JSON.stringify({
      attemptId: '22222222-2222-4222-8222-222222222222',
      pid: process.pid,
      processIdentity: currentProcessIdentity()
    }));

    await reconcileAbandonedRunRecords(record);

    await expect(fs.access(leasePath)).resolves.toBeUndefined();
  });

  it('does not reclaim the attempt lease of a genuinely running record', async () => {
    const record = await roomRecord();
    const attemptId = '33333333-3333-4333-8333-333333333333';
    const filename = 'run_00000000000000000000000000000003.json';
    await fs.writeFile(
      path.join(record.roomRoot, 'runs', filename),
      JSON.stringify({
        id: 'run_00000000000000000000000000000003',
        kind: 'discussion',
        status: 'running',
        attemptId,
        ownerPid: process.pid,
        ownerProcessIdentity: currentProcessIdentity(),
        sourceProvenance: { mode: 'room-only', startedAt: '2026-01-03T00:00:00.000Z' },
        startedAt: '2026-01-03T00:00:00.000Z'
      }, null, 2)
    );
    const leasePath = path.join(record.roomRoot, 'runs', `.attempt-${attemptId}.lease`);
    await fs.writeFile(leasePath, JSON.stringify({
      attemptId,
      pid: process.pid,
      processIdentity: currentProcessIdentity()
    }));

    await reconcileAbandonedRunRecords(record);

    const reconciled = JSON.parse(await fs.readFile(
      path.join(record.roomRoot, 'runs', filename),
      'utf-8'
    ));
    expect(reconciled.status).toBe('running');
    await expect(fs.access(leasePath)).resolves.toBeUndefined();
  });
});
