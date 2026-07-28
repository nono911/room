import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
const syncedPaths: string[] = [];

vi.mock('fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('fs/promises')>();
  return {
    ...original,
    open: async (target: string, ...rest: unknown[]) => {
      const handle = await (original.open as (...args: never[]) => Promise<
        import('fs/promises').FileHandle
      >)(target as never, ...(rest as never[]));
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        syncedPaths.push(target);
        return sync();
      };
      return handle;
    }
  };
});

const { writeFileAtomically } = await import('./atomicFile.js');

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await actual.mkdtemp(path.join(os.tmpdir(), 'room-atomic-file-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  syncedPaths.length = 0;
  await Promise.all(roots.splice(0).map(root => actual.rm(root, { recursive: true, force: true })));
});

describe('atomic file writes', () => {
  it('writes the content with owner-only permissions and leaves no temp file', async () => {
    const root = await temporaryRoot();
    const destination = path.join(root, 'room.json');

    await writeFileAtomically(destination, '{"schemaVersion":1}\n');

    expect(await actual.readFile(destination, 'utf-8')).toBe('{"schemaVersion":1}\n');
    expect((await actual.stat(destination)).mode & 0o777).toBe(0o600);
    expect(await actual.readdir(root)).toEqual(['room.json']);
  });

  it('flushes the content and the rename before reporting success', async () => {
    const root = await temporaryRoot();
    const destination = path.join(root, 'room.json');

    await writeFileAtomically(destination, 'durable');

    // Content first, then the directory entry that publishes it — a crash
    // between them must never surface a present-but-empty destination.
    expect(syncedPaths.some(target => target.startsWith(path.join(root, '.room.json'))))
      .toBe(true);
    expect(syncedPaths).toContain(root);
  });

  it('removes the temp file and rethrows when the rename fails', async () => {
    const root = await temporaryRoot();
    const destination = path.join(root, 'room.json');
    // A non-empty directory at the destination makes rename(2) fail after the
    // temp file already exists, which is the path that must not leak it.
    await actual.mkdir(destination);
    await actual.writeFile(path.join(destination, 'occupied'), 'x');

    await expect(writeFileAtomically(destination, 'unused')).rejects.toThrow();
    expect(await actual.readdir(root)).toEqual(['room.json']);
  });
});
