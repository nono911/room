import * as fs from 'fs/promises';
import { listDirectoryNamesBounded } from '../boundedFs.js';
import { readRoomTextFile } from '../roomFile.js';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';

export async function listMarkdownByMtime(
  workspace: WorkspaceInput,
  section: 'decisions' | 'documents',
  match: (file: string) => boolean,
  limit: number
): Promise<{ name: string; content: string }[]> {
  try {
    const listing = await listDirectoryNamesBounded(resolveRoomPath(workspace, section), 1_000);
    const files = listing.names.filter(
      file => file.toLowerCase().endsWith('.md') && match(file)
    );
    const stats = await Promise.all(files.map(async name => ({
      name,
      mtimeMs: (await fs.stat(resolveRoomPath(workspace, section, name))).mtimeMs
    })));
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return Promise.all(stats.slice(0, limit).map(async ({ name }) => ({
      name,
      content: await readRoomTextFile(workspace, [section, name], 1024 * 1024)
    })));
  } catch {
    return [];
  }
}
