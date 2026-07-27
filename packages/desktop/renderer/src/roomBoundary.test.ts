// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomRecord } from '@room/engine';
import {
  bindCurrentRoom,
  createSourceProvenance,
  requireBoundProjectRoot,
  requireBoundRoom,
  requireBoundWorkspace,
  resolveCanonicalWithinProject,
  resolveWithinRoomData
} from '../../main/ipc/shared.js';

const temporaryRoots: string[] = [];

async function fixture(): Promise<{ record: RoomRecord; sourceRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-boundary-'));
  temporaryRoots.push(root);
  const sourceRoot = path.join(root, 'source');
  const roomRoot = path.join(root, 'home', 'rooms', 'room_personal');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(roomRoot, { recursive: true });
  const canonicalPath = await fs.realpath(sourceRoot);
  return {
    sourceRoot,
    record: {
      roomRoot,
      manifest: {
        schemaVersion: 1,
        id: 'room_personal',
        name: 'Personal Room',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
        activeSourceId: 'source_a',
        sources: [{
          id: 'source_a',
          type: 'directory',
          name: 'Source A',
          path: sourceRoot,
          canonicalPath,
          attachedAt: '2026-01-01T00:00:00.000Z'
        }]
      }
    }
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('Room and Source IPC boundary', () => {
  it('resolves IDs in main and never accepts a renderer path as Room identity', async () => {
    const { record, sourceRoot } = await fixture();
    bindCurrentRoom(record);

    expect(requireBoundRoom('room_personal').roomRoot).toBe(record.roomRoot);
    expect(requireBoundProjectRoot('room_personal', 'source_a'))
      .toBe(await fs.realpath(sourceRoot));
    expect(() => requireBoundRoom(sourceRoot)).toThrow('Room is not active');
    expect(() => requireBoundProjectRoot('room_personal', 'source_missing'))
      .toThrow('not attached');
    expect(() => resolveWithinRoomData('room_personal', '..', 'escape'))
      .toThrow('Invalid ROOM data path');
  });

  it('snapshots source provenance independently of later active-source changes', async () => {
    const { record } = await fixture();
    bindCurrentRoom(record);
    const workspaceSnapshot = requireBoundWorkspace('room_personal', 'source_a');
    const provenance = createSourceProvenance(requireBoundRoom('room_personal'), workspaceSnapshot);

    bindCurrentRoom({
      ...record,
      manifest: {
        ...record.manifest,
        sources: [],
        activeSourceId: undefined
      }
    });

    expect(provenance).toEqual({
      mode: 'source',
      sourceId: 'source_a',
      sourceName: 'Source A'
    });
    expect(createSourceProvenance(requireBoundRoom('room_personal'), requireBoundWorkspace('room_personal')))
      .toEqual({ mode: 'room-only' });
  });

  it('rejects traversal and symlink escape beneath an attached Source', async () => {
    const { sourceRoot } = await fixture();
    const outside = path.join(path.dirname(sourceRoot), 'outside.txt');
    await fs.writeFile(outside, 'secret', 'utf-8');
    await fs.symlink(outside, path.join(sourceRoot, 'escape.txt'));

    await expect(resolveCanonicalWithinProject(sourceRoot, '../outside.txt'))
      .rejects.toThrow('Invalid path');
    await expect(resolveCanonicalWithinProject(sourceRoot, 'escape.txt'))
      .rejects.toThrow('symbolic links');
  });

  it('rejects an attached Source root replaced with a symlink', async () => {
    const { record, sourceRoot } = await fixture();
    bindCurrentRoom(record);
    const movedSource = `${sourceRoot}-moved`;
    const replacementTarget = path.join(path.dirname(sourceRoot), 'replacement');
    await fs.rename(sourceRoot, movedSource);
    await fs.mkdir(replacementTarget);
    await fs.symlink(replacementTarget, sourceRoot, 'dir');

    expect(() => requireBoundWorkspace('room_personal', 'source_a'))
      .toThrow('no longer a real directory');
  });
});
