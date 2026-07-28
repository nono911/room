import * as fs from 'fs/promises';
import * as path from 'path';

const SIDECAR_GRACE_MS = 10 * 60 * 1000;
const MAX_INSPECTED_ENTRIES = 10_000;
const MAX_DIRECTORIES = 1_000;
const JANITOR_BUDGET_MS = 1_000;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const TEMPORARY_FILE_PATTERNS = [
  new RegExp(`^\\.room\\.${UUID}\\.tmp$`, 'i'),
  new RegExp(`^\\.current-${UUID}\\.tmp$`, 'i'),
  new RegExp(`^\\..+\\.${UUID}\\.tmp$`, 'i'),
  new RegExp(`^[^.].+\\.${UUID}\\.tmp$`, 'i')
];
const LOCK_SIDECAR_PATTERN =
  /^\.[a-z0-9_-]{1,80}\.lock-(?:(?:candidate|release)-[a-zA-Z0-9_-]{1,160}|owner-[a-f0-9]{32})$/;

function isOwnedSidecar(name: string): boolean {
  return LOCK_SIDECAR_PATTERN.test(name)
    || TEMPORARY_FILE_PATTERNS.some(pattern => pattern.test(name));
}

export async function cleanupStaleRoomSidecars(roomRoot: string): Promise<void> {
  const pending = [path.resolve(roomRoot)];
  const deadline = Date.now() + JANITOR_BUDGET_MS;
  let inspectedEntries = 0;
  let inspectedDirectories = 0;
  while (
    pending.length > 0
    && inspectedEntries < MAX_INSPECTED_ENTRIES
    && inspectedDirectories < MAX_DIRECTORIES
    && Date.now() <= deadline
  ) {
    const directoryPath = pending.pop()!;
    inspectedDirectories += 1;
    let directory: Awaited<ReturnType<typeof fs.opendir>>;
    try {
      directory = await fs.opendir(directoryPath);
    } catch {
      continue;
    }
    try {
      for await (const entry of directory) {
        inspectedEntries += 1;
        if (inspectedEntries > MAX_INSPECTED_ENTRIES || Date.now() > deadline) break;
        const entryPath = path.join(directoryPath, entry.name);
        if (isOwnedSidecar(entry.name)) {
          const stat = await fs.lstat(entryPath).catch(() => null);
          if (
            stat
            && !stat.isSymbolicLink()
            && Date.now() - stat.mtimeMs >= SIDECAR_GRACE_MS
          ) {
            await fs.rm(entryPath, {
              recursive: stat.isDirectory(),
              force: true
            }).catch(() => undefined);
          }
          continue;
        }
        if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(entryPath);
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
  }
}
