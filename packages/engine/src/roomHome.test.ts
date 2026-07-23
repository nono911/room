import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  createRoomWorkspace,
  findRoomWorkspaceBySource,
  listRoomWorkspaces,
  toWorkspaceLocation
} from './roomHome.js';

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-home-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('ROOM Home workspaces', () => {
  it('creates central workspace data without writing .room into the source', async () => {
    const root = await createTemporaryRoot();
    const sourceRoot = path.join(root, 'source');
    const roomHome = path.join(root, 'home');
    await fs.mkdir(sourceRoot);

    const result = await createRoomWorkspace({
      sourceRoot,
      roomHome,
      name: 'Example'
    });

    expect(result.created).toBe(true);
    expect(result.record.roomRoot.startsWith(path.join(roomHome, 'workspaces'))).toBe(true);
    expect(await fs.readFile(path.join(result.record.roomRoot, 'context', 'overview.md'), 'utf-8'))
      .toContain('# Workspace Name');
    await expect(fs.stat(path.join(sourceRoot, '.room'))).rejects.toThrow();
    expect(toWorkspaceLocation(result.record)).toEqual({
      sourceRoot,
      roomRoot: result.record.roomRoot
    });
  });

  it('copies legacy data once and keeps the legacy source untouched', async () => {
    const root = await createTemporaryRoot();
    const sourceRoot = path.join(root, 'source');
    const legacyRoot = path.join(sourceRoot, '.room');
    const roomHome = path.join(root, 'home');
    await fs.mkdir(path.join(legacyRoot, 'documents'), { recursive: true });
    await fs.writeFile(path.join(legacyRoot, 'documents', 'notes.md'), '# Legacy notes\n', 'utf-8');

    const first = await createRoomWorkspace({ sourceRoot, roomHome });
    const second = await createRoomWorkspace({ sourceRoot, roomHome });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.manifest.id).toBe(first.record.manifest.id);
    expect(first.record.manifest.legacyImport?.fileCount).toBe(1);
    expect(await fs.readFile(path.join(first.record.roomRoot, 'documents', 'notes.md'), 'utf-8'))
      .toBe('# Legacy notes\n');
    expect(await fs.readFile(path.join(legacyRoot, 'documents', 'notes.md'), 'utf-8'))
      .toBe('# Legacy notes\n');
    expect(await listRoomWorkspaces(roomHome)).toHaveLength(1);
    expect((await findRoomWorkspaceBySource(sourceRoot, roomHome))?.manifest.id)
      .toBe(first.record.manifest.id);
  });

  it('does not import a top-level legacy .room symlink', async () => {
    const root = await createTemporaryRoot();
    const sourceRoot = path.join(root, 'source');
    const outsideRoot = path.join(root, 'outside');
    const roomHome = path.join(root, 'home');
    await fs.mkdir(sourceRoot);
    await fs.mkdir(outsideRoot);
    await fs.writeFile(path.join(outsideRoot, 'secret.md'), '# Outside\n', 'utf-8');
    await fs.symlink(outsideRoot, path.join(sourceRoot, '.room'), 'dir');

    const result = await createRoomWorkspace({ sourceRoot, roomHome });

    expect(result.record.manifest.legacyImport).toBeUndefined();
    await expect(fs.stat(path.join(result.record.roomRoot, 'secret.md'))).rejects.toThrow();
    expect((await fs.lstat(path.join(sourceRoot, '.room'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(outsideRoot, 'secret.md'), 'utf-8')).toBe('# Outside\n');
  });

  it('removes machine skill selections from imported legacy agents', async () => {
    const root = await createTemporaryRoot();
    const sourceRoot = path.join(root, 'source');
    const legacyMembers = path.join(sourceRoot, '.room', 'members');
    const roomHome = path.join(root, 'home');
    const legacyAgent = {
      name: 'Imported Reviewer',
      role: 'Reviewer',
      provider: 'gemini',
      systemPrompt: 'Review the work.',
      skills: ['review.md', 'machine://codex/playwright']
    };
    await fs.mkdir(legacyMembers, { recursive: true });
    await fs.writeFile(
      path.join(legacyMembers, 'reviewer.json'),
      JSON.stringify(legacyAgent, null, 2),
      'utf-8'
    );

    const result = await createRoomWorkspace({ sourceRoot, roomHome });
    const imported = JSON.parse(await fs.readFile(
      path.join(result.record.roomRoot, 'members', 'reviewer.json'),
      'utf-8'
    )) as { skills?: string[] };
    const source = JSON.parse(await fs.readFile(
      path.join(legacyMembers, 'reviewer.json'),
      'utf-8'
    )) as { skills?: string[] };

    expect(imported.skills).toEqual(['review.md']);
    expect(source.skills).toEqual(['review.md', 'machine://codex/playwright']);
  });

  it('rejects attaching a directory inside ROOM Home', async () => {
    const root = await createTemporaryRoot();
    const roomHome = path.join(root, 'home');
    const sourceRoot = path.join(roomHome, 'workspaces', 'manual');
    await fs.mkdir(sourceRoot, { recursive: true });

    await expect(createRoomWorkspace({ sourceRoot, roomHome }))
      .rejects.toThrow('cannot be attached');
  });

  it('does not treat ROOM Home itself as legacy project data', async () => {
    const root = await createTemporaryRoot();
    const sourceRoot = path.join(root, 'source');
    const roomHome = path.join(sourceRoot, '.room');
    await fs.mkdir(roomHome, { recursive: true });
    await fs.writeFile(path.join(roomHome, 'global-state.json'), '{}\n', 'utf-8');

    const result = await createRoomWorkspace({ sourceRoot, roomHome });

    expect(result.record.manifest.legacyImport).toBeUndefined();
    await expect(fs.stat(path.join(result.record.roomRoot, 'global-state.json'))).rejects.toThrow();
    expect(await fs.readFile(path.join(roomHome, 'global-state.json'), 'utf-8')).toBe('{}\n');
  });
});
