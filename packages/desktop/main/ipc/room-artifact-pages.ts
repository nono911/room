import * as fs from 'fs/promises';
import { roomArtifactSectionEntryLimit } from '@room/engine';
import type { RoomArtifactSection } from '../../shared/types/domain.js';
import { resolveWithinRoomData } from './shared.js';

export interface RoomArtifactPage {
  files: string[];
  nextCursor?: string;
  hasMore: boolean;
  truncated: boolean;
}

const MAX_PAGE_SIZE = 200;

function acceptsArtifact(section: RoomArtifactSection, filename: string): boolean {
  if (section === 'discussions') return /^discussion-[\w-]+\.json$/i.test(filename);
  if (section === 'tasks') {
    return filename.toLowerCase().endsWith('.md')
      && !/^task-[\w-]+\.md$/i.test(filename)
      && !filename.toLowerCase().endsWith('-artifact.md');
  }
  return true;
}

export async function listRoomArtifactPage(
  roomId: string,
  section: RoomArtifactSection,
  cursor?: string,
  requestedLimit = MAX_PAGE_SIZE
): Promise<RoomArtifactPage> {
  const page = await listRoomDirectoryPage(
    resolveWithinRoomData(roomId, section),
    `artifact:${section}`,
    filename => acceptsArtifact(section, filename),
    'asc',
    cursor,
    requestedLimit
  );
  return section === 'discussions'
    ? {
        ...page,
        files: page.files.map(filename => filename.replace(/\.json$/i, '.md'))
      }
    : page;
}

export async function listRoomTaskRunPageNames(
  roomId: string,
  cursor?: string,
  requestedLimit = MAX_PAGE_SIZE
): Promise<RoomArtifactPage> {
  return listRoomDirectoryPage(
    resolveWithinRoomData(roomId, 'tasks'),
    'task-runs',
    filename => (
      /^task-[\w-]+\.json$/i.test(filename)
    ),
    'desc',
    cursor,
    requestedLimit
  );
}

async function listRoomDirectoryPage(
  directoryPath: string,
  scope: string,
  accepts: (filename: string) => boolean,
  direction: 'asc' | 'desc',
  cursor?: string,
  requestedLimit = MAX_PAGE_SIZE
): Promise<RoomArtifactPage> {
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(requestedLimit)));
  const after = decodeCursor(cursor, scope);
  const names: string[] = [];
  const compare = (left: string, right: string): number => (
    direction === 'asc'
      ? left.localeCompare(right)
      : right.localeCompare(left)
  );
  const insertCandidate = (name: string): void => {
    let low = 0;
    let high = names.length;
    while (low < high) {
      const midpoint = Math.floor((low + high) / 2);
      if (compare(name, names[midpoint]) < 0) high = midpoint;
      else low = midpoint + 1;
    }
    names.splice(low, 0, name);
    if (names.length > limit + 1) names.pop();
  };
  const entryLimit = roomArtifactSectionEntryLimit();
  let inspected = 0;
  try {
    const directory = await fs.opendir(directoryPath);
    try {
      for await (const entry of directory) {
        inspected += 1;
        if (inspected > entryLimit) {
          throw new Error(
            `ROOM artifact directory exceeds its capacity of ${entryLimit} entries.`
          );
        }
        if (
          entry.name.startsWith('.')
          || !entry.isFile()
          || !accepts(entry.name)
        ) continue;
        if (
          after !== undefined
          && (
            direction === 'asc'
              ? entry.name.localeCompare(after) <= 0
              : entry.name.localeCompare(after) >= 0
          )
        ) continue;
        insertCandidate(entry.name);
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
  const files = names.slice(0, limit);
  const hasMore = names.length > limit;
  return {
    files,
    nextCursor: hasMore && files.length > 0
      ? encodeCursor(scope, files[files.length - 1])
      : undefined,
    hasMore,
    truncated: false
  };
}

function encodeCursor(scope: string, after: string): string {
  return Buffer.from(JSON.stringify({ version: 1, scope, after }), 'utf-8')
    .toString('base64url');
}

function decodeCursor(cursor: string | undefined, scope: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf-8')
    ) as Record<string, unknown>;
    if (
      parsed.version !== 1
      || parsed.scope !== scope
      || typeof parsed.after !== 'string'
      || !parsed.after
      || parsed.after.startsWith('.')
      || /[\\/]/.test(parsed.after)
      || Buffer.byteLength(parsed.after, 'utf-8') > 255
    ) throw new Error('Invalid cursor.');
    return parsed.after;
  } catch {
    throw new Error('Invalid ROOM listing cursor.');
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
