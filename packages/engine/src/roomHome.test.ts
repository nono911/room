import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import {
  attachRoomSource,
  detachRoomSource,
  ensurePersonalRoom,
  getRoomById,
  listRooms,
  setActiveRoomSource,
  toWorkspaceLocation,
  toRoomOnlyLocation,
  withRoomDataLock
} from './roomHome.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-home-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('Personal Room domain', () => {
  it('builds an explicit Room-only location even when a Source is active', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);
    const sourceContainer = await temporaryRoot();
    const sourcePath = path.join(sourceContainer, 'source-room-only');
    await fs.mkdir(sourcePath);
    const attached = await attachRoomSource(room, sourcePath, 'Active Source');

    expect(toRoomOnlyLocation(attached)).toEqual({
      roomId: attached.manifest.id,
      roomRoot: attached.roomRoot
    });
  });
  it('creates a source-less Personal Room under ROOM Home', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);

    expect(room.manifest).toMatchObject({
      id: 'room_personal',
      name: 'Personal Room',
      sources: []
    });
    expect(room.manifest.activeSourceId).toBeUndefined();
    expect(room.roomRoot).toBe(path.join(roomHome, 'rooms', 'room_personal'));
    expect(toWorkspaceLocation(room)).toEqual({
      roomId: 'room_personal',
      roomRoot: room.roomRoot,
      sourceId: undefined,
      sourceName: undefined,
      sourceRoot: undefined
    });
    expect(await fs.readFile(path.join(room.roomRoot, 'context', 'overview.md'), 'utf-8'))
      .toContain('# Personal Room');
    expect(await listRooms(roomHome)).toHaveLength(1);
    expect((await getRoomById('room_personal', roomHome))?.manifest.id).toBe('room_personal');
  });

  it('fails closed without overwriting a present unsupported Room manifest', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);
    const manifestPath = path.join(room.roomRoot, 'room.json');
    const unsupported = JSON.stringify({ ...room.manifest, schemaVersion: 2 }, null, 2);
    await fs.writeFile(manifestPath, unsupported, 'utf-8');

    await expect(ensurePersonalRoom(roomHome)).rejects.toThrow('unsupported schema');
    expect(await fs.readFile(manifestPath, 'utf-8')).toBe(unsupported);
  });

  it('attaches and detaches a Source without deleting Room memory or Source files', async () => {
    const root = await temporaryRoot();
    const roomHome = path.join(root, 'home');
    const sourceRoot = path.join(root, 'source');
    await fs.mkdir(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, 'keep.txt'), 'source', 'utf-8');
    const room = await ensurePersonalRoom(roomHome);
    await fs.writeFile(path.join(room.roomRoot, 'documents', 'memory.md'), '# Memory\n', 'utf-8');

    const attached = await attachRoomSource(room, sourceRoot);
    const sourceId = attached.manifest.activeSourceId;
    const canonicalSource = await fs.realpath(sourceRoot);
    expect(sourceId).toMatch(/^source_[a-f0-9]{32}$/);
    expect(toWorkspaceLocation(attached)).toEqual({
      roomId: 'room_personal',
      roomRoot: room.roomRoot,
      sourceRoot: canonicalSource,
      sourceId,
      sourceName: 'source'
    });

    const detached = await detachRoomSource(attached, sourceId!);
    expect(detached.manifest.sources).toEqual([]);
    expect(detached.manifest.activeSourceId).toBeUndefined();
    expect(await fs.readFile(path.join(room.roomRoot, 'documents', 'memory.md'), 'utf-8'))
      .toBe('# Memory\n');
    expect(await fs.readFile(path.join(sourceRoot, 'keep.txt'), 'utf-8')).toBe('source');

    const reattached = await attachRoomSource(detached, sourceRoot);
    expect(reattached.manifest.activeSourceId).toBe(sourceId);
    expect(reattached.manifest.sources[0].id).toBe(sourceId);
    expect(reattached.manifest.detachedSources).toEqual([]);
  });

  it('moves a replaced Source identity into detached history', async () => {
    const root = await temporaryRoot();
    const roomHome = path.join(root, 'home');
    const sourceRoot = path.join(root, 'source');
    await fs.mkdir(sourceRoot);
    const attached = await attachRoomSource(
      await ensurePersonalRoom(roomHome),
      sourceRoot
    );
    const previousId = attached.manifest.activeSourceId!;
    await fs.rename(sourceRoot, path.join(root, 'previous-source'));
    await fs.mkdir(sourceRoot);

    const rebound = await attachRoomSource(
      (await getRoomById('room_personal', roomHome))!,
      sourceRoot
    );

    expect(rebound.manifest.activeSourceId).not.toBe(previousId);
    expect(rebound.manifest.detachedSources?.map(source => source.id))
      .toContain(previousId);
  });

  it('keeps the Room readable when an attached Source moves onto another attached Source path', async () => {
    const root = await temporaryRoot();
    const roomHome = path.join(root, 'home');
    const firstPath = path.join(root, 'first');
    const secondPath = path.join(root, 'second');
    await fs.mkdir(firstPath);
    await fs.mkdir(secondPath);

    const first = await attachRoomSource(await ensurePersonalRoom(roomHome), firstPath);
    const second = await attachRoomSource(first, secondPath);
    const firstId = first.manifest.activeSourceId!;
    const secondId = second.manifest.activeSourceId!;

    // A rename preserves dev/ino/birthtime, so the Source that already exists
    // under another id now also claims the first Source's canonical path.
    await fs.rm(firstPath, { recursive: true });
    await fs.rename(secondPath, firstPath);

    const rebound = await attachRoomSource(
      (await getRoomById('room_personal', roomHome))!,
      firstPath
    );

    expect(rebound.manifest.activeSourceId).toBe(secondId);
    expect(rebound.manifest.sources.map(source => source.id)).toEqual([secondId]);
    expect(rebound.manifest.detachedSources?.map(source => source.id))
      .toContain(firstId);

    // The persisted manifest must survive its own read-time validation.
    await expect(getRoomById('room_personal', roomHome)).resolves.not.toBeNull();
  });

  it('supports multiple attached Sources while exposing one active Source', async () => {
    const root = await temporaryRoot();
    const room = await ensurePersonalRoom(path.join(root, 'home'));
    const firstPath = path.join(root, 'first');
    const secondPath = path.join(root, 'second');
    await fs.mkdir(firstPath);
    await fs.mkdir(secondPath);

    const first = await attachRoomSource(room, firstPath);
    const second = await attachRoomSource(first, secondPath);
    const firstId = first.manifest.activeSourceId!;
    const switched = await setActiveRoomSource(second, firstId);

    expect(switched.manifest.sources).toHaveLength(2);
    expect(switched.manifest.activeSourceId).toBe(firstId);
    expect(toWorkspaceLocation(switched).sourceRoot).toBe(await fs.realpath(firstPath));
  });

  it('serializes concurrent Source attachments without losing either Source', async () => {
    const root = await temporaryRoot();
    const room = await ensurePersonalRoom(path.join(root, 'home'));
    const firstPath = path.join(root, 'first');
    const secondPath = path.join(root, 'second');
    await fs.mkdir(firstPath);
    await fs.mkdir(secondPath);

    await Promise.all([
      attachRoomSource(room, firstPath),
      attachRoomSource(room, secondPath)
    ]);

    const reloaded = await getRoomById('room_personal', path.join(root, 'home'));
    expect(reloaded?.manifest.sources.map(source => source.name).sort())
      .toEqual(['first', 'second']);
  });

  it('serializes Source attachments across independent processes', async () => {
    const root = await temporaryRoot();
    const roomHome = path.join(root, 'home');
    const sourcePaths = Array.from({ length: 6 }, (_, index) => path.join(root, `source-${index}`));
    await Promise.all(sourcePaths.map(sourcePath => fs.mkdir(sourcePath)));
    const viteNode = path.resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'vite-node');
    const fixturePath = path.resolve(process.cwd(), 'src', 'roomHome.multiprocess.fixture.ts');
    const run = promisify(execFile);

    await Promise.all(sourcePaths.map(sourcePath =>
      run(viteNode, [fixturePath, roomHome, sourcePath])
    ));

    const reloaded = await getRoomById('room_personal', roomHome);
    expect(reloaded?.manifest.sources.map(source => source.name).sort())
      .toEqual(sourcePaths.map(sourcePath => path.basename(sourcePath)).sort());
  });

  it('quarantines only a lock owned by a terminated process', async () => {
    const room = await ensurePersonalRoom(await temporaryRoot());
    const staleLock = path.join(room.roomRoot, '.recovery.lock');
    const token = 'a'.repeat(32);
    await fs.mkdir(staleLock);
    await fs.writeFile(
      path.join(staleLock, 'owner.json'),
      JSON.stringify({
        token,
        pid: 2_147_483_647,
        processIdentity: 'terminated-process'
      })
    );

    const value = await withRoomDataLock(room.roomRoot, 'recovery', async () => 'locked');
    expect(value).toBe('locked');
    await expect(fs.access(staleLock)).rejects.toThrow();
    expect((await fs.readdir(room.roomRoot))).toContain(
      `.recovery.lock-owner-${token}`
    );
  });

  it('keeps stale-lock recovery mutually exclusive across processes', async () => {
    const room = await ensurePersonalRoom(await temporaryRoot());
    const staleLock = path.join(room.roomRoot, '.stale-race.lock');
    const token = 'b'.repeat(32);
    await fs.mkdir(staleLock);
    await fs.writeFile(
      path.join(staleLock, 'owner.json'),
      JSON.stringify({
        token,
        pid: 2_147_483_647,
        processIdentity: 'terminated-process'
      })
    );
    const viteNode = path.resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'vite-node');
    const fixturePath = path.resolve(
      process.cwd(),
      'src',
      'roomDataLock.multiprocess.fixture.ts'
    );
    const run = promisify(execFile);

    await Promise.all(Array.from({ length: 8 }, (_, index) => (
      run(viteNode, [fixturePath, room.roomRoot, String(index)])
    )));

    await expect(fs.access(path.join(room.roomRoot, '.critical-violation')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(room.roomRoot))).toContain(
      `.stale-race.lock-owner-${token}`
    );
  }, 15_000);

  it('takes over a recovery claim abandoned by a terminated claimant', async () => {
    const room = await ensurePersonalRoom(await temporaryRoot());
    const lockPath = path.join(room.roomRoot, '.claim-crash.lock');
    const ownerToken = 'c'.repeat(32);
    await fs.mkdir(lockPath);
    await fs.writeFile(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({
        token: ownerToken,
        pid: 2_147_483_647,
        processIdentity: 'terminated-process'
      })
    );
    await fs.writeFile(
      path.join(lockPath, `.recovery-${ownerToken}-0`),
      JSON.stringify({
        token: 'd'.repeat(32),
        pid: 2_147_483_647,
        processIdentity: 'terminated-process',
        generation: 0
      })
    );

    await expect(withRoomDataLock(
      room.roomRoot,
      'claim-crash',
      async () => 'recovered'
    )).resolves.toBe('recovered');
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it('expires a lock lease even when its PID has been reused', async () => {
    const room = await ensurePersonalRoom(await temporaryRoot());
    const lockPath = path.join(room.roomRoot, '.pid-reuse.lock');
    const ownerToken = 'e'.repeat(32);
    const ownerPath = path.join(lockPath, 'owner.json');
    await fs.mkdir(lockPath);
    await fs.writeFile(
      ownerPath,
      JSON.stringify({
        token: ownerToken,
        pid: process.pid,
        processIdentity: 'different-process-incarnation'
      })
    );
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(ownerPath, stale, stale);

    await expect(withRoomDataLock(
      room.roomRoot,
      'pid-reuse',
      async () => 'recovered'
    )).resolves.toBe('recovered');
  });

  it('fails closed for malformed lock ownership after the grace period', async () => {
    const room = await ensurePersonalRoom(await temporaryRoot());
    const invalidLock = path.join(room.roomRoot, '.invalid.lock');
    await fs.mkdir(invalidLock);
    await fs.writeFile(path.join(invalidLock, 'owner.json'), '{"partial":');
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(invalidLock, old, old);

    await expect(withRoomDataLock(room.roomRoot, 'invalid', async () => 'unsafe'))
      .rejects.toThrow('lock ownership is invalid');
    await expect(fs.access(invalidLock)).resolves.toBeUndefined();
  });

  it('rejects an oversized manifest before parsing it', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);
    const manifestPath = path.join(room.roomRoot, 'room.json');
    await fs.writeFile(manifestPath, ' '.repeat(300 * 1024), 'utf-8');

    await expect(ensurePersonalRoom(roomHome)).rejects.toThrow('read limit');
    expect((await fs.stat(manifestPath)).size).toBe(300 * 1024);
  });

  it('removes only stale ROOM-owned crash sidecars during startup', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);
    const stale = path.join(
      room.roomRoot,
      '.room.123e4567-e89b-42d3-a456-426614174000.tmp'
    );
    const staleLockTombstone = path.join(
      room.roomRoot,
      `.cleanup.lock-owner-${'a'.repeat(32)}`
    );
    const ordinary = path.join(room.roomRoot, 'documents', 'keep.tmp');
    await fs.writeFile(stale, 'stale', 'utf-8');
    await fs.mkdir(staleLockTombstone);
    await fs.writeFile(ordinary, 'keep', 'utf-8');
    const old = new Date(Date.now() - 15 * 60 * 1000);
    await fs.utimes(stale, old, old);
    await fs.utimes(staleLockTombstone, old, old);

    await ensurePersonalRoom(roomHome);

    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(staleLockTombstone)).rejects.toThrow();
    await expect(fs.readFile(ordinary, 'utf-8')).resolves.toBe('keep');
  });

  it('marks an abandoned recorded run interrupted during startup recovery', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);
    const runPath = path.join(
      room.roomRoot,
      'runs',
      'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
    );
    await fs.writeFile(runPath, JSON.stringify({
      id: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      attemptId: 'abandoned-attempt',
      ownerPid: 2_147_483_647,
      kind: 'discussion',
      status: 'running',
      subjectId: 'discussion-abandoned',
      sourceProvenance: {
        mode: 'room-only',
        roomId: 'room_personal',
        startedAt: '2026-07-27T00:00:00.000Z'
      },
      startedAt: '2026-07-27T00:00:00.000Z'
    }));

    await ensurePersonalRoom(roomHome);

    expect(JSON.parse(await fs.readFile(runPath, 'utf-8'))).toMatchObject({
      status: 'interrupted',
      error: 'Run interrupted before completion.',
      completedAt: expect.any(String)
    });
  });

  it('interrupts an abandoned run whose PID was reused by another process', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const runPath = path.join(
      room.roomRoot,
      'runs',
      'run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
    );
    const leasePath = path.join(room.roomRoot, 'runs', `.attempt-${attemptId}.lease`);
    await fs.writeFile(leasePath, JSON.stringify({
      attemptId,
      pid: process.pid,
      processIdentity: 'different-process-incarnation'
    }));
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(leasePath, stale, stale);
    await fs.writeFile(runPath, JSON.stringify({
      id: 'run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      attemptId,
      ownerPid: process.pid,
      kind: 'task',
      status: 'running',
      sourceProvenance: {
        mode: 'room-only',
        roomId: 'room_personal',
        startedAt: '2026-07-27T00:00:00.000Z'
      },
      startedAt: '2026-07-27T00:00:00.000Z'
    }));

    await ensurePersonalRoom(roomHome);

    expect(JSON.parse(await fs.readFile(runPath, 'utf-8'))).toMatchObject({
      status: 'interrupted',
      error: 'Run interrupted before completion.'
    });
    await expect(fs.access(leasePath)).rejects.toThrow();
  });

  it('rejects ROOM Home, traversal-like IDs, and unknown Source IDs', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);

    await expect(attachRoomSource(room, roomHome)).rejects.toThrow('overlap ROOM Home');
    await expect(attachRoomSource(room, path.parse(roomHome).root)).rejects.toThrow('filesystem root');
    await expect(attachRoomSource(room, path.dirname(roomHome))).rejects.toThrow('overlap ROOM Home');
    expect(await getRoomById('../escape', roomHome)).toBeNull();
    expect(() => toWorkspaceLocation(room, 'source_missing')).toThrow('not attached');
    await expect(setActiveRoomSource(room, 'source_missing')).rejects.toThrow('not attached');
  });

  it('records canonical paths and does not follow an attached symlink alias later', async () => {
    const root = await temporaryRoot();
    const realSource = path.join(root, 'real');
    const sourceAlias = path.join(root, 'alias');
    await fs.mkdir(realSource);
    await fs.symlink(realSource, sourceAlias, 'dir');
    const room = await ensurePersonalRoom(path.join(root, 'home'));

    const attached = await attachRoomSource(room, sourceAlias);
    expect(attached.manifest.sources[0].path).toBe(sourceAlias);
    expect(attached.manifest.sources[0].canonicalPath).toBe(await fs.realpath(realSource));
    expect(toWorkspaceLocation(attached).sourceRoot).toBe(await fs.realpath(realSource));
  });

  it('rejects symlinks inside ROOM managed storage', async () => {
    const root = await temporaryRoot();
    const roomHome = path.join(root, 'home');
    const externalDirectory = path.join(root, 'external');
    await fs.mkdir(externalDirectory);
    const room = await ensurePersonalRoom(roomHome);
    const documentsDirectory = path.join(room.roomRoot, 'documents');
    await fs.rm(documentsDirectory, { recursive: true });
    await fs.symlink(externalDirectory, documentsDirectory, 'dir');

    await expect(ensurePersonalRoom(roomHome)).rejects.toThrow('must be a real directory');
    expect(await fs.readdir(externalDirectory)).toEqual([]);
  });

  it('rejects a persisted Source that is changed to an unsafe root', async () => {
    const root = await temporaryRoot();
    const roomHome = path.join(root, 'home');
    const sourceRoot = path.join(root, 'source');
    await fs.mkdir(sourceRoot);
    const room = await attachRoomSource(await ensurePersonalRoom(roomHome), sourceRoot);
    const manifestPath = path.join(room.roomRoot, 'room.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    manifest.sources[0].path = path.parse(root).root;
    manifest.sources[0].canonicalPath = path.parse(root).root;
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

    await expect(getRoomById('room_personal', roomHome)).rejects.toThrow('unsafe Source');
  });

  it('keeps Room memory available when an attached Source is temporarily missing', async () => {
    const root = await temporaryRoot();
    const roomHome = path.join(root, 'home');
    const sourceRoot = path.join(root, 'source');
    await fs.mkdir(sourceRoot);
    const attached = await attachRoomSource(await ensurePersonalRoom(roomHome), sourceRoot);
    await fs.writeFile(path.join(attached.roomRoot, 'documents', 'memory.md'), 'Still here', 'utf-8');
    await fs.rm(sourceRoot, { recursive: true });

    const reloaded = await getRoomById('room_personal', roomHome);
    expect(reloaded?.manifest.sources).toHaveLength(1);
    expect(await fs.readFile(path.join(attached.roomRoot, 'documents', 'memory.md'), 'utf-8'))
      .toBe('Still here');
  });
});
