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
  requireBoundRoomWorkspace,
  requireBoundWorkspace,
  resolveCanonicalWithinProject,
  resolveWithinRoomData
} from '../../main/ipc/shared.js';
import { buildSelectedContext } from '../../main/ipc/context-bundle.js';
import { writeRoomDataFileAtomically } from '../../main/ipc/room-file-write.js';
import { readWorkspaceFilePreview } from '../../main/ipc/workspace-preview.js';

const temporaryRoots: string[] = [];
const SOURCE_A = 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function fixture(): Promise<{ record: RoomRecord; sourceRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-boundary-'));
  temporaryRoots.push(root);
  const sourceRoot = path.join(root, 'source');
  const roomRoot = path.join(root, 'home', 'rooms', 'room_personal');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(roomRoot, { recursive: true });
  const canonicalPath = await fs.realpath(sourceRoot);
  const sourceStat = await fs.lstat(canonicalPath, { bigint: true });
  const record: RoomRecord = {
      roomRoot,
      manifest: {
        schemaVersion: 1,
        id: 'room_personal',
        name: 'Personal Room',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
        activeSourceId: SOURCE_A,
        sources: [{
          id: SOURCE_A,
          type: 'directory',
          name: 'Source A',
          path: sourceRoot,
          canonicalPath,
          rootDevice: sourceStat.dev.toString(),
          rootInode: sourceStat.ino.toString(),
          rootBirthtimeNs: sourceStat.birthtimeNs.toString(),
          attachedAt: '2026-01-01T00:00:00.000Z'
        }]
      }
  };
  await fs.writeFile(path.join(roomRoot, 'room.json'), JSON.stringify(record.manifest), 'utf-8');
  return { sourceRoot, record };
}

async function persistAndBind(record: RoomRecord): Promise<void> {
  await fs.writeFile(path.join(record.roomRoot, 'room.json'), JSON.stringify(record.manifest), 'utf-8');
  bindCurrentRoom(record);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('Room and Source IPC boundary', () => {
  it('keeps independently bound Room identities available concurrently', async () => {
    const first = await fixture();
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-boundary-second-'));
    temporaryRoots.push(secondRoot);
    const secondRoomRoot = path.join(secondRoot, 'rooms', 'room_second');
    await fs.mkdir(secondRoomRoot, { recursive: true });
    const secondRecord: RoomRecord = {
      roomRoot: secondRoomRoot,
      manifest: {
        schemaVersion: 1,
        id: 'room_second',
        name: 'Second Room',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
        sources: []
      }
    };
    await persistAndBind(first.record);
    await persistAndBind(secondRecord);

    expect(requireBoundRoom('room_personal').roomRoot).toBe(first.record.roomRoot);
    expect(requireBoundRoom('room_second').roomRoot).toBe(secondRoomRoot);
  });

  it('resolves IDs in main and never accepts a renderer path as Room identity', async () => {
    const { record, sourceRoot } = await fixture();
    await persistAndBind(record);

    expect(requireBoundRoom('room_personal').roomRoot).toBe(record.roomRoot);
    expect(requireBoundProjectRoot('room_personal', SOURCE_A))
      .toBe(await fs.realpath(sourceRoot));
    expect(() => requireBoundRoom(sourceRoot)).toThrow('Invalid Room ID');
    expect(() => requireBoundProjectRoot('room_personal', 'source_missing'))
      .toThrow('not attached');
    expect(() => resolveWithinRoomData('room_personal', '..', 'escape'))
      .toThrow('Invalid ROOM data path');
  });

  it('snapshots source provenance independently of later active-source changes', async () => {
    const { record } = await fixture();
    await persistAndBind(record);
    const workspaceSnapshot = requireBoundWorkspace('room_personal', SOURCE_A);
    const provenance = createSourceProvenance(requireBoundRoom('room_personal'), workspaceSnapshot);

    await persistAndBind({
      ...record,
      manifest: {
        ...record.manifest,
        sources: [],
        activeSourceId: undefined
      }
    });

    expect(provenance).toMatchObject({
      mode: 'source',
      roomId: 'room_personal',
      sourceId: SOURCE_A,
      sourceName: 'Source A',
      startedAt: expect.any(String)
    });
    expect(createSourceProvenance(requireBoundRoom('room_personal'), requireBoundWorkspace('room_personal')))
      .toMatchObject({
        mode: 'room-only',
        roomId: 'room_personal',
        startedAt: expect.any(String)
      });
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
    await persistAndBind(record);
    const movedSource = `${sourceRoot}-moved`;
    const replacementTarget = path.join(path.dirname(sourceRoot), 'replacement');
    await fs.rename(sourceRoot, movedSource);
    await fs.mkdir(replacementTarget);
    await fs.symlink(replacementTarget, sourceRoot, 'dir');

    expect(() => requireBoundWorkspace('room_personal', SOURCE_A))
      .toThrow(/unsafe Source|active Source path changed/);
    await expect(readWorkspaceFilePreview(record.manifest.sources[0], 'secret.md'))
      .rejects.toThrow();
  });

  it('keeps Room memory available while rejecting a recreated Source by identity', async () => {
    const { record, sourceRoot } = await fixture();
    await persistAndBind(record);
    await fs.rename(sourceRoot, `${sourceRoot}-old`);
    await fs.mkdir(sourceRoot);

    expect(requireBoundRoom('room_personal').manifest.id).toBe('room_personal');
    const roomWorkspace = requireBoundRoomWorkspace('room_personal');
    expect(roomWorkspace).toMatchObject({
      roomId: 'room_personal',
      roomRoot: record.roomRoot
    });
    expect(roomWorkspace).not.toHaveProperty('sourceId');
    await writeRoomDataFileAtomically(
      'room_personal',
      ['context', 'room-only-after-source-loss.md'],
      'Room memory remains writable.'
    );
    expect(await fs.readFile(
      path.join(record.roomRoot, 'context', 'room-only-after-source-loss.md'),
      'utf-8'
    )).toBe('Room memory remains writable.');
    expect(() => requireBoundWorkspace('room_personal', SOURCE_A))
      .toThrow('active Source path changed');
  });

  it('rejects a bound Room root replaced by another valid-looking Room directory', async () => {
    const { record } = await fixture();
    await persistAndBind(record);
    const movedRoom = `${record.roomRoot}-moved`;
    await fs.rename(record.roomRoot, movedRoom);
    await fs.mkdir(record.roomRoot);
    await fs.writeFile(path.join(record.roomRoot, 'room.json'), JSON.stringify({
      ...record.manifest,
      activeSourceId: undefined,
      sources: []
    }), 'utf-8');

    expect(() => requireBoundRoom('room_personal'))
      .toThrow('managed path changed after it was opened');
  });

  it('refreshes authoritative Room membership before new Source operations', async () => {
    const { record } = await fixture();
    await persistAndBind(record);
    await fs.writeFile(path.join(record.roomRoot, 'room.json'), JSON.stringify({
      ...record.manifest,
      activeSourceId: undefined,
      sources: []
    }), 'utf-8');

    expect(() => requireBoundWorkspace('room_personal', SOURCE_A))
      .toThrow('is not attached');
  });

  it('binds a Source-qualified context reference to the Source captured for the run', async () => {
    const { record, sourceRoot } = await fixture();
    const secondRoot = path.join(path.dirname(sourceRoot), 'second');
    await fs.mkdir(secondRoot);
    await fs.writeFile(path.join(sourceRoot, 'README.md'), 'First Source content', 'utf-8');
    await fs.writeFile(path.join(secondRoot, 'README.md'), 'Second Source content', 'utf-8');
    const secondStat = await fs.lstat(secondRoot, { bigint: true });
    const secondSourceId = 'source_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const firstSource = record.manifest.sources[0];
    const secondSource = {
      id: secondSourceId,
      type: 'directory' as const,
      name: 'Source B',
      path: secondRoot,
      canonicalPath: await fs.realpath(secondRoot),
      rootDevice: secondStat.dev.toString(),
      rootInode: secondStat.ino.toString(),
      rootBirthtimeNs: secondStat.birthtimeNs.toString(),
      attachedAt: '2026-01-01T00:00:00.000Z'
    };
    await persistAndBind({
      ...record,
      manifest: {
        ...record.manifest,
        activeSourceId: secondSourceId,
        sources: [
          ...record.manifest.sources,
          secondSource
        ]
      }
    });

    const context = await buildSelectedContext(
      'room_personal',
      firstSource,
      [`source-file:${SOURCE_A}:README.md`]
    );
    expect(context).toContain('First Source content');
    expect(context).not.toContain('Second Source content');
    await fs.writeFile(path.join(record.roomRoot, 'room.json'), JSON.stringify({
      ...record.manifest,
      activeSourceId: secondSourceId,
      sources: [secondSource]
    }), 'utf-8');
    await expect(buildSelectedContext(
      'room_personal',
      firstSource,
      [`source-file:${SOURCE_A}:README.md`]
    )).resolves.toContain('First Source content');
    await expect(buildSelectedContext(
      'room_personal',
      secondSource,
      [`source-file:${SOURCE_A}:README.md`]
    )).rejects.toThrow('must belong to the Source captured for this run');
    await expect(buildSelectedContext(
      'room_personal',
      undefined,
      [`source-file:${SOURCE_A}:README.md`]
    )).rejects.toThrow('must belong to the Source captured for this run');
  });

  it('loads prior task artifacts through document context references', async () => {
    const { record } = await fixture();
    await persistAndBind(record);
    await fs.mkdir(path.join(record.roomRoot, 'documents'), { recursive: true });
    await fs.writeFile(
      path.join(record.roomRoot, 'documents', 'task-parent-artifact.md'),
      '# Prior artifact\n\nKeep this deliverable.',
      'utf-8'
    );

    await expect(buildSelectedContext(
      'room_personal',
      undefined,
      ['document:task-parent-artifact.md']
    )).resolves.toContain('Keep this deliverable.');
  });

  it('does not place canonical filesystem errors into provider context', async () => {
    const { record, sourceRoot } = await fixture();
    await persistAndBind(record);
    const documents = path.join(record.roomRoot, 'documents');
    const external = path.join(path.dirname(record.roomRoot), 'private-context.md');
    await fs.mkdir(documents, { recursive: true });
    await fs.writeFile(external, 'private', 'utf-8');
    await fs.symlink(external, path.join(documents, 'broken.md'));

    const context = await buildSelectedContext(
      'room_personal',
      undefined,
      ['document:broken.md']
    );

    expect(context).toContain('[Unable to include selected context.]');
    expect(context).not.toContain(record.roomRoot);
    expect(context).not.toContain(external);

    await fs.symlink(external, path.join(sourceRoot, 'broken.md'));
    const sourceContext = await buildSelectedContext(
      'room_personal',
      record.manifest.sources[0],
      [`source-file:${SOURCE_A}:broken.md`]
    );
    expect(sourceContext).toContain('[Unable to include selected context.]');
    expect(sourceContext).not.toContain(sourceRoot);
    expect(sourceContext).not.toContain(external);

    await fs.writeFile(path.join(sourceRoot, '.env'), 'SECRET=provider-sentinel');
    const hiddenContext = await buildSelectedContext(
      'room_personal',
      record.manifest.sources[0],
      [`source-file:${SOURCE_A}:.env`]
    );
    expect(hiddenContext).toContain('[Unable to include selected context.]');
    expect(hiddenContext).not.toContain('provider-sentinel');
  });

  it('rejects a symlink introduced beneath Room-managed data after binding', async () => {
    const { record } = await fixture();
    const external = path.join(path.dirname(record.roomRoot), 'external');
    await fs.mkdir(external);
    await fs.symlink(external, path.join(record.roomRoot, 'documents'), 'dir');
    await persistAndBind(record);

    expect(() => resolveWithinRoomData('room_personal', 'documents', 'secret.md'))
      .toThrow('symbolic links');
  });

  it('never follows final-component symlinks for Room artifact writes', async () => {
    const { record } = await fixture();
    await persistAndBind(record);
    const external = path.join(path.dirname(record.roomRoot), 'outside.txt');
    await fs.writeFile(external, 'do not replace', 'utf-8');
    const artifactPaths = [
      ['documents', 'report.md'],
      ['context', 'overview.md'],
      ['members', 'mem_test.json'],
      ['skills', 'review.md'],
      ['teams', 'team_test.json'],
      ['config', 'mcp.json']
    ];

    for (const artifactParts of artifactPaths) {
      const parent = path.join(record.roomRoot, ...artifactParts.slice(0, -1));
      const destination = path.join(record.roomRoot, ...artifactParts);
      await fs.mkdir(parent, { recursive: true });
      await fs.symlink(external, destination);

      await expect(writeRoomDataFileAtomically(
        'room_personal',
        artifactParts,
        'attempted overwrite'
      )).rejects.toThrow('symbolic links');
      expect(await fs.readFile(external, 'utf-8')).toBe('do not replace');
      await fs.unlink(destination);
    }
  });
});
