import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function writeFileAtomically(
  destination: string,
  content: string
): Promise<void> {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.tmp`
  );
  // rename(2) orders the namespace change but does not guarantee the content
  // reached stable storage first. Without both fsyncs a crash can leave the
  // destination present and empty — for room.json that locks the Room out.
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, { encoding: 'utf-8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  await syncDirectory(path.dirname(destination));
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not supported everywhere; the rename itself still holds.
  } finally {
    await handle?.close();
  }
}
