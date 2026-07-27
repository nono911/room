import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  attachRoomSource,
  detachRoomSource,
  ensurePersonalRoom,
  getRoomById,
  listRooms,
  setActiveRoomSource,
  toWorkspaceLocation
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
    expect(toWorkspaceLocation(room)).toEqual({ roomRoot: room.roomRoot });
    expect(await fs.readFile(path.join(room.roomRoot, 'context', 'overview.md'), 'utf-8'))
      .toContain('# Personal Room');
    expect(await listRooms(roomHome)).toHaveLength(1);
    expect((await getRoomById('room_personal', roomHome))?.manifest.id).toBe('room_personal');
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
      roomRoot: room.roomRoot,
      sourceRoot: canonicalSource,
      sourceId
    });

    const detached = await detachRoomSource(attached, sourceId!);
    expect(detached.manifest.sources).toEqual([]);
    expect(detached.manifest.activeSourceId).toBeUndefined();
    expect(await fs.readFile(path.join(room.roomRoot, 'documents', 'memory.md'), 'utf-8'))
      .toBe('# Memory\n');
    expect(await fs.readFile(path.join(sourceRoot, 'keep.txt'), 'utf-8')).toBe('source');
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

  it('rejects ROOM Home, traversal-like IDs, and unknown Source IDs', async () => {
    const roomHome = await temporaryRoot();
    const room = await ensurePersonalRoom(roomHome);

    await expect(attachRoomSource(room, roomHome)).rejects.toThrow('ROOM Home');
    await expect(attachRoomSource(room, path.parse(roomHome).root)).rejects.toThrow('filesystem root');
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
});
