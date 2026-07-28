import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';

const MAX_SKILL_FILE_BYTES = 512 * 1024;

export async function readMachineSkillFile(
  canonicalFile: string,
  reference: string
): Promise<string> {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fs.open(canonicalFile, fsConstants.O_RDONLY | noFollow);
  try {
    const [opened, current] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(canonicalFile, { bigint: true })
    ]);
    if (
      !opened.isFile()
      || current.isSymbolicLink()
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || opened.size > BigInt(MAX_SKILL_FILE_BYTES)
    ) {
      throw new Error(`Machine skill cannot be read safely: ${reference}`);
    }
    const buffer = Buffer.alloc(MAX_SKILL_FILE_BYTES + 1);
    let total = 0;
    while (total <= MAX_SKILL_FILE_BYTES) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        Math.min(64 * 1024, MAX_SKILL_FILE_BYTES + 1 - total),
        total
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_SKILL_FILE_BYTES) {
      throw new Error(`Machine skill cannot be read safely: ${reference}`);
    }
    return buffer.subarray(0, total).toString('utf-8');
  } finally {
    await handle.close();
  }
}
