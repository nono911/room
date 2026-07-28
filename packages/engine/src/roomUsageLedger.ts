import * as fs from 'fs/promises';
import * as path from 'path';
import { writeFileAtomically } from './atomicFile.js';
import { readUtf8FileBounded } from './boundedFs.js';
import { withRoomDataLock } from './roomDataLock.js';

const ROOM_STORAGE_ENTRY_LIMIT = 100_000;
const LEDGER_FILENAME = '.room-usage.json';
const DIRTY_FILENAME = '.room-usage-dirty';

interface RoomUsageLedger {
  version: 1;
  bytes: number;
  entries: number;
}

export interface RoomUsageDelta {
  bytes: number;
  entries: number | null;
}

export async function roomPathUsageBytes(root: string): Promise<number> {
  return (await scanRoomUsage(root)).bytes;
}

export async function withRoomUsageTransaction<T>(
  roomRoot: string,
  quotaBytes: number,
  measureDeltaBytes: () => Promise<number | RoomUsageDelta | null>,
  operation: () => Promise<T>
): Promise<T> {
  return withRoomDataLock(roomRoot, 'storage-quota', async () => {
    const current = await loadOrReconcileUsage(roomRoot);
    const measured = await measureDeltaBytes();
    const delta = typeof measured === 'number'
      ? { bytes: measured, entries: 0 }
      : measured;
    if (
      delta !== null
      && (
        !Number.isSafeInteger(delta.bytes)
        || (delta.entries !== null && !Number.isSafeInteger(delta.entries))
      )
    ) {
      throw new Error('Invalid ROOM storage transaction delta.');
    }
    const projectedBytes = delta === null
      ? null
      : Math.max(0, current.bytes + delta.bytes);
    const projectedEntries = delta === null
      ? null
      : delta.entries === null ? null : Math.max(0, current.entries + delta.entries);
    if (projectedBytes !== null && projectedBytes > quotaBytes) {
      throw new Error('ROOM storage quota exceeded.');
    }
    if (projectedEntries !== null && projectedEntries > ROOM_STORAGE_ENTRY_LIMIT) {
      throw new Error('ROOM storage contains too many entries.');
    }
    const dirtyPath = path.join(roomRoot, DIRTY_FILENAME);
    await fs.writeFile(dirtyPath, 'pending\n', {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx'
    });
    try {
      const result = await operation();
      const updated = projectedBytes === null || projectedEntries === null
        ? await scanRoomUsage(roomRoot)
        : { ...current, bytes: projectedBytes, entries: projectedEntries };
      if (updated.bytes > quotaBytes) throw new Error('ROOM storage quota exceeded.');
      if (updated.entries > ROOM_STORAGE_ENTRY_LIMIT) {
        throw new Error('ROOM storage contains too many entries.');
      }
      await writeUsageLedger(roomRoot, updated);
      await fs.rm(dirtyPath, { force: true });
      return result;
    } catch (error) {
      // The marker deliberately remains so the next writer reconciles after a partial operation.
      throw error;
    }
  });
}

async function loadOrReconcileUsage(roomRoot: string): Promise<RoomUsageLedger> {
  const dirtyPath = path.join(roomRoot, DIRTY_FILENAME);
  const dirty = await fs.lstat(dirtyPath).catch(error => {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  });
  if (dirty?.isSymbolicLink() || (dirty && !dirty.isFile())) {
    throw new Error('ROOM usage recovery marker must be a real file.');
  }
  if (!dirty) {
    const ledger = await readUsageLedger(roomRoot);
    if (ledger) return ledger;
  }
  const usage = await scanRoomUsage(roomRoot);
  await writeUsageLedger(roomRoot, usage);
  await fs.rm(dirtyPath, { force: true });
  return usage;
}

async function readUsageLedger(roomRoot: string): Promise<RoomUsageLedger | null> {
  let content: string;
  try {
    content = await readUtf8FileBounded(
      path.join(roomRoot, LEDGER_FILENAME),
      4 * 1024
    );
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(content) as Partial<RoomUsageLedger>;
    if (
      parsed.version !== 1
      || !Number.isSafeInteger(parsed.bytes)
      || parsed.bytes! < 0
      || !Number.isSafeInteger(parsed.entries)
      || parsed.entries! < 0
      || parsed.entries! > ROOM_STORAGE_ENTRY_LIMIT
    ) return null;
    return parsed as RoomUsageLedger;
  } catch {
    return null;
  }
}

async function writeUsageLedger(
  roomRoot: string,
  usage: Omit<RoomUsageLedger, 'version'> | RoomUsageLedger
): Promise<void> {
  await writeFileAtomically(
    path.join(roomRoot, LEDGER_FILENAME),
    `${JSON.stringify({ version: 1, bytes: usage.bytes, entries: usage.entries })}\n`
  );
}

async function scanRoomUsage(root: string): Promise<RoomUsageLedger> {
  let bytes = 0;
  let entries = 0;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let handle: Awaited<ReturnType<typeof fs.opendir>>;
    try {
      handle = await fs.opendir(directory);
    } catch (error: unknown) {
      if (hasErrorCode(error, 'ENOENT') && directory !== root) continue;
      throw error;
    }
    try {
      for await (const entry of handle) {
        if (
          directory === root
          && (
            entry.name === LEDGER_FILENAME
            || entry.name === DIRTY_FILENAME
            || entry.name === 'room.json'
            || /^\.[a-z0-9_-]{1,80}\.lock(?:-|$)/.test(entry.name)
          )
        ) continue;
        if (directory.endsWith(`${path.sep}runs`) && /^\.attempt-.+\.lease$/.test(entry.name)) {
          continue;
        }
        entries += 1;
        if (entries > ROOM_STORAGE_ENTRY_LIMIT) {
          throw new Error('ROOM storage contains too many entries.');
        }
        const resolved = path.join(directory, entry.name);
        const stat = await fs.lstat(resolved).catch(error => {
          if (hasErrorCode(error, 'ENOENT')) return null;
          throw error;
        });
        if (!stat) continue;
        if (stat.isSymbolicLink()) throw new Error('Room data paths cannot contain symbolic links.');
        if (stat.isDirectory()) pending.push(resolved);
        else if (stat.isFile()) bytes += stat.size;
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
  return { version: 1, bytes, entries };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
