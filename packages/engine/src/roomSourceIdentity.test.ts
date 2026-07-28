import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  attachRoomSource,
  detachRoomSource,
  ensurePersonalRoom,
  getRoomById,
  toWorkspaceLocation
} from './roomHome.js';
import { requireStableSourceBirthtime } from './sourceIdentity.js';
import { roomPathUsageBytes } from './roomFile.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('Room Source identity', () => {
  it('refreshes the path while preserving the Source ID after a directory move', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-source-move-'));
    temporaryRoots.push(root);
    const room = await ensurePersonalRoom(path.join(root, 'home'));
    const originalPath = path.join(root, 'original');
    const movedPath = path.join(root, 'moved');
    await fs.mkdir(originalPath);

    const attached = await attachRoomSource(room, originalPath, 'Original');
    const sourceId = attached.manifest.activeSourceId;
    await fs.rename(originalPath, movedPath);
    const reattached = await attachRoomSource(attached, movedPath);

    expect(reattached.manifest.activeSourceId).toBe(sourceId);
    expect(reattached.manifest.sources).toHaveLength(1);
    expect(reattached.manifest.sources[0]).toMatchObject({
      id: sourceId,
      name: 'moved',
      path: movedPath,
      canonicalPath: await fs.realpath(movedPath)
    });
    expect(toWorkspaceLocation(reattached).sourceRoot).toBe(await fs.realpath(movedPath));
  });

  it('reassociates Source memory after detached history no longer contains the Source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-source-memory-'));
    temporaryRoots.push(root);
    const room = await ensurePersonalRoom(path.join(root, 'home'));
    const sourcePath = path.join(root, 'source');
    await fs.mkdir(sourcePath);

    const attached = await attachRoomSource(room, sourcePath);
    const sourceId = attached.manifest.activeSourceId!;
    const detached = await detachRoomSource(attached, sourceId);
    const manifestPath = path.join(detached.roomRoot, 'room.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    manifest.detachedSources = [];
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

    const reattached = await attachRoomSource(detached, sourcePath);

    expect(reattached.manifest.activeSourceId).toBe(sourceId);
    expect(reattached.manifest.sources).toHaveLength(1);
    await expect(fs.access(path.join(
      reattached.roomRoot,
      'sources',
      sourceId,
      'identity.json'
    ))).resolves.toBeUndefined();
  });

  it('does not publish a Source manifest when identity persistence exceeds quota', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-source-atomic-'));
    temporaryRoots.push(root);
    const roomHome = path.join(root, 'home');
    const room = await ensurePersonalRoom(roomHome);
    const sourcePath = path.join(root, 'source');
    await fs.mkdir(sourcePath);
    const previousQuota = process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;
    process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = String(
      await roomPathUsageBytes(room.roomRoot)
    );
    try {
      await expect(attachRoomSource(room, sourcePath))
        .rejects.toThrow('storage quota exceeded');
      const persisted = await getRoomById(room.manifest.id, roomHome);
      expect(persisted?.manifest.sources).toEqual([]);
      expect(persisted?.manifest.activeSourceId).toBeUndefined();
    } finally {
      if (previousQuota === undefined) delete process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;
      else process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = previousQuota;
    }
  });

  it('rejects an unreadable oversized manifest before persisting Source identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-manifest-boundary-'));
    temporaryRoots.push(root);
    const roomHome = path.join(root, 'home');
    const room = await ensurePersonalRoom(roomHome);
    const manifestPath = path.join(room.roomRoot, 'room.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    const limit = 256 * 1024;
    const sourceRecord = (index: number, tailLength: number) => ({
      id: `source_${index.toString(16).padStart(32, '0')}`,
      type: 'directory',
      name: `Detached ${index}`,
      path: `/tmp/room-detached-${index}-${'x'.repeat(tailLength)}`,
      canonicalPath: `/tmp/room-detached-${index}-${'x'.repeat(tailLength)}`,
      rootDevice: String(index + 1),
      rootInode: String(index + 1),
      rootBirthtimeNs: String(index + 1),
      attachedAt: '2026-01-01T00:00:00.000Z'
    });
    const detached: unknown[] = [];
    let index = 0;
    while (index < 255) {
      const candidate = [...detached, sourceRecord(index, 3_000)];
      const size = Buffer.byteLength(JSON.stringify({
        ...manifest,
        detachedSources: candidate
      }, null, 2)) + 1;
      if (size > limit - 5_000) break;
      detached.push(candidate.at(-1)!);
      index += 1;
    }
    let fullest = [...detached];
    let lower = 1;
    let upper = 4_000;
    while (lower <= upper) {
      const tailLength = Math.floor((lower + upper) / 2);
      const candidate = [...detached, sourceRecord(index, tailLength)];
      const size = Buffer.byteLength(JSON.stringify({
        ...manifest,
        detachedSources: candidate
      }, null, 2)) + 1;
      if (size <= limit - 64) {
        fullest = candidate;
        lower = tailLength + 1;
      } else {
        upper = tailLength - 1;
      }
    }
    manifest.detachedSources = fullest;
    const baseline = `${JSON.stringify(manifest, null, 2)}\n`;
    expect(Buffer.byteLength(baseline)).toBeLessThan(limit);
    await fs.writeFile(manifestPath, baseline, 'utf-8');
    const readable = await getRoomById(room.manifest.id, roomHome);
    const sourcePath = path.join(root, 'source');
    await fs.mkdir(sourcePath);

    await expect(attachRoomSource(readable!, sourcePath))
      .rejects.toThrow('manifest exceeds its storage limit');
    expect(await fs.readFile(manifestPath, 'utf-8')).toBe(baseline);
    expect(await fs.readdir(path.join(room.roomRoot, 'sources'))).toEqual([]);
    await expect(getRoomById(room.manifest.id, roomHome)).resolves.not.toBeNull();
  });

  it('rejects filesystems without a stable Source creation identity', () => {
    expect(() => requireStableSourceBirthtime(0n))
      .toThrow('stable creation identity');
    expect(() => requireStableSourceBirthtime(-1n))
      .toThrow('stable creation identity');
    expect(() => requireStableSourceBirthtime(1n)).not.toThrow();
  });
});
