import * as fsSync from 'fs';
import * as fs from 'fs/promises';

export interface BoundedDirectoryListing {
  names: string[];
  truncated: boolean;
}

function assertReadLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) {
    throw new Error('Invalid bounded file read limit.');
  }
}

export async function readUtf8FileBounded(
  filePath: string,
  maxBytes: number
): Promise<string> {
  assertReadLimit(maxBytes);
  const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number'
    ? fsSync.constants.O_NOFOLLOW
    : 0;
  const handle = await fs.open(filePath, fsSync.constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Managed data item must be a real file.');
    if (stat.size > maxBytes) throw new Error('Managed data file exceeds its read limit.');
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total <= maxBytes) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        Math.min(64 * 1024, maxBytes + 1 - total),
        total
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error('Managed data file exceeds its read limit.');
    return buffer.subarray(0, total).toString('utf-8');
  } finally {
    await handle.close();
  }
}

export async function readUtf8FilePrefix(
  filePath: string,
  maxBytes: number
): Promise<string> {
  assertReadLimit(maxBytes);
  const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number'
    ? fsSync.constants.O_NOFOLLOW
    : 0;
  const handle = await fs.open(filePath, fsSync.constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Managed data item must be a real file.');
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        Math.min(64 * 1024, buffer.length - total),
        total
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return buffer.subarray(0, total).toString('utf-8');
  } finally {
    await handle.close();
  }
}

export function readUtf8FileBoundedSync(filePath: string, maxBytes: number): string {
  assertReadLimit(maxBytes);
  const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number'
    ? fsSync.constants.O_NOFOLLOW
    : 0;
  const descriptor = fsSync.openSync(filePath, fsSync.constants.O_RDONLY | noFollow);
  try {
    const stat = fsSync.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('Managed data item must be a real file.');
    if (stat.size > maxBytes) throw new Error('Managed data file exceeds its read limit.');
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total <= maxBytes) {
      const bytesRead = fsSync.readSync(
        descriptor,
        buffer,
        total,
        Math.min(64 * 1024, maxBytes + 1 - total),
        total
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error('Managed data file exceeds its read limit.');
    return buffer.subarray(0, total).toString('utf-8');
  } finally {
    fsSync.closeSync(descriptor);
  }
}

export async function listDirectoryNamesBounded(
  directoryPath: string,
  maxEntries: number,
  maxDurationMs = 2_000
): Promise<BoundedDirectoryListing> {
  if (
    !Number.isSafeInteger(maxEntries)
    || maxEntries < 1
    || maxEntries > 100_000
    || !Number.isSafeInteger(maxDurationMs)
    || maxDurationMs < 1
    || maxDurationMs > 30_000
  ) {
    throw new Error('Invalid bounded directory listing limit.');
  }
  const names: string[] = [];
  const deadline = Date.now() + maxDurationMs;
  const directory = await fs.opendir(directoryPath);
  try {
    while (names.length < maxEntries && Date.now() <= deadline) {
      const entry = await directory.read();
      if (!entry) return { names, truncated: false };
      names.push(entry.name);
    }
    const additional = await directory.read();
    return { names, truncated: Boolean(additional) };
  } finally {
    await directory.close();
  }
}

export async function readFirstExistingUtf8Bounded(
  paths: string[],
  maxBytes: number
): Promise<string> {
  for (const filePath of paths) {
    try {
      return await readUtf8FileBounded(filePath, maxBytes);
    } catch {}
  }
  return '';
}
