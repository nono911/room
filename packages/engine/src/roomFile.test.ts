import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readRoomTextFile,
  withRoomStorageReconciliation,
  withRoomStorageTransaction,
  writeRoomTextFile
} from './roomFile.js';

const roots: string[] = [];

afterEach(async () => {
  delete process.env.ROOM_TEST_ARTIFACT_ENTRY_LIMIT;
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('Room file boundary', () => {
  it('rejects final-component symlinks for reads and writes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-file-boundary-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    const external = path.join(root, 'external.txt');
    await fs.mkdir(path.join(roomRoot, 'documents'), { recursive: true });
    await fs.writeFile(external, 'outside', 'utf-8');
    await fs.symlink(external, path.join(roomRoot, 'documents', 'artifact.md'));
    const workspace = { roomId: 'room_test', roomRoot };

    await expect(readRoomTextFile(workspace, ['documents', 'artifact.md']))
      .rejects.toThrow('symbolic link');
    await expect(writeRoomTextFile(
      workspace,
      ['documents', 'artifact.md'],
      'replacement'
    )).rejects.toThrow('symbolic link');
    expect(await fs.readFile(external, 'utf-8')).toBe('outside');
  });

  it('rejects a non-finite caller measurement before running a storage mutation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-file-delta-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    let mutated = false;

    await expect(withRoomStorageTransaction(
      { roomId: 'room_test', roomRoot },
      async () => Number.NaN,
      async () => {
        mutated = true;
      }
    )).rejects.toThrow('Invalid ROOM storage transaction delta');
    expect(mutated).toBe(false);
  });

  it('enforces the artifact capacity before creating an unreachable entry', async () => {
    process.env.ROOM_TEST_ARTIFACT_ENTRY_LIMIT = '2';
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-file-capacity-'));
    roots.push(root);
    const workspace = { roomId: 'room_test', roomRoot: path.join(root, 'room') };
    await fs.mkdir(workspace.roomRoot);

    await writeRoomTextFile(workspace, ['documents', 'one.md'], 'one');
    await writeRoomTextFile(workspace, ['documents', 'two.md'], 'two');
    await expect(writeRoomTextFile(
      workspace,
      ['documents', 'three.md'],
      'three'
    )).rejects.toThrow('capacity of 2 entries');

    await expect(writeRoomTextFile(
      workspace,
      ['documents', 'two.md'],
      'updated'
    )).resolves.toBeUndefined();
  });

  it('updates a usage ledger and reconciles after an interrupted mutation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-file-ledger-'));
    roots.push(root);
    const workspace = { roomId: 'room_test', roomRoot: path.join(root, 'room') };
    await fs.mkdir(workspace.roomRoot);
    await writeRoomTextFile(workspace, ['documents', 'one.md'], 'one');
    const ledgerPath = path.join(workspace.roomRoot, '.room-usage.json');
    const initial = JSON.parse(await fs.readFile(ledgerPath, 'utf-8'));
    expect(initial).toMatchObject({ version: 1, bytes: 3, entries: 2 });

    await fs.writeFile(path.join(workspace.roomRoot, '.room-usage-dirty'), 'pending\n');
    await fs.writeFile(path.join(workspace.roomRoot, 'external.txt'), 'outside', 'utf-8');
    await writeRoomTextFile(workspace, ['documents', 'two.md'], 'two');

    const reconciled = JSON.parse(await fs.readFile(ledgerPath, 'utf-8'));
    expect(reconciled.bytes).toBe(13);
    expect(reconciled.entries).toBe(4);
    await expect(fs.access(path.join(workspace.roomRoot, '.room-usage-dirty')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rebuilds corrupt ledgers and reconciles deletions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-file-rebuild-'));
    roots.push(root);
    const workspace = { roomId: 'room_test', roomRoot: path.join(root, 'room') };
    await fs.mkdir(workspace.roomRoot);
    await writeRoomTextFile(workspace, ['documents', 'one.md'], 'one');
    const ledgerPath = path.join(workspace.roomRoot, '.room-usage.json');
    await fs.writeFile(ledgerPath, '{not-json', 'utf-8');

    await writeRoomTextFile(workspace, ['documents', 'two.md'], 'two');
    expect(JSON.parse(await fs.readFile(ledgerPath, 'utf-8')).bytes).toBe(6);
    await withRoomStorageReconciliation(workspace, () =>
      fs.unlink(path.join(workspace.roomRoot, 'documents', 'one.md'))
    );
    expect(JSON.parse(await fs.readFile(ledgerPath, 'utf-8')))
      .toMatchObject({ bytes: 3, entries: 2 });
  });

});
