import * as path from 'path';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import {
  createRoomSkillReference,
  refreshRoomRecordSync,
  toRoomOnlyLocation,
  toWorkspaceLocation,
  type RoomRecord,
  type RoomSource,
  type SourceProvenance,
  type WorkspaceLocation
} from '@room/engine';

export const ROOM_DIR = '.room';
export const ALLOWED_ROOM_FILE_SECTIONS = ['documents', 'tasks', 'discussions', 'decisions', 'reviews', 'skills'] as const;
export const WORKSPACE_FILE_LIMIT = 500;
export const WORKSPACE_FILE_READ_LIMIT_BYTES = 1024 * 1024;
export const CONTEXT_SEARCH_SCAN_LIMIT = 2500;
export const CONTEXT_SEARCH_RESULT_LIMIT = 80;
export const CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES = 48 * 1024;
export const DISCUSSION_CONTEXT_FILE_LIMIT_BYTES = 200 * 1024;
export const DISCUSSION_CONTEXT_TOTAL_LIMIT = 700 * 1024;
export const IGNORED_WORKSPACE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-packaged',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache'
]);

export interface ContextSearchResult {
  ref: string;
  label: string;
  type: 'workspace' | 'task' | 'doc' | 'discussion' | 'file';
  path?: string;
  detail: string;
  modifiedAt?: string;
  size?: number;
}

export interface SkillPreviewItem {
  filename: string;
  readable: boolean;
  source?: 'skills' | 'roles';
  bytes?: number;
  heading?: string;
  error?: string;
}

const boundRooms = new Map<string, RoomRecord>();
const roomMutationQueues = new Map<string, Promise<void>>();

export function resolveProjectPath(dirPath: string): string {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    throw new Error('Invalid path.');
  }
  return path.resolve(dirPath);
}

export function bindCurrentRoom(record: RoomRecord): RoomRecord {
  const roomRoot = path.resolve(record.roomRoot);
  const stat = fsSync.lstatSync(roomRoot, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`ROOM managed path must be a real directory: ${roomRoot}`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) {
    throw new Error(`ROOM managed path must be owned by the current user: ${roomRoot}`);
  }
  const previousRecord = boundRooms.get(record.manifest.id);
  const previousIdentity = previousRecord?.roomRoot === roomRoot
    ? previousRecord
    : null;
  const rootDevice = record.rootDevice || previousIdentity?.rootDevice || stat.dev.toString();
  const rootInode = record.rootInode || previousIdentity?.rootInode || stat.ino.toString();
  if (rootDevice !== stat.dev.toString() || rootInode !== stat.ino.toString()) {
    throw new Error(`ROOM managed path changed after it was opened: ${roomRoot}`);
  }
  const boundRecord = {
    manifest: {
      ...record.manifest,
      sources: record.manifest.sources.map(source => ({ ...source })),
      detachedSources: record.manifest.detachedSources?.map(source => ({ ...source }))
    },
    roomRoot,
    rootDevice,
    rootInode
  };
  boundRooms.set(record.manifest.id, boundRecord);
  return boundRecord;
}

export async function mutateBoundRoom(
  roomId: string,
  mutate: (record: RoomRecord) => Promise<RoomRecord>
): Promise<RoomRecord> {
  const previous = roomMutationQueues.get(roomId) || Promise.resolve();
  let release = (): void => {};
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  roomMutationQueues.set(roomId, queued);
  await previous;
  try {
    return bindCurrentRoom(await mutate(requireBoundRoom(roomId)));
  } finally {
    release();
    if (roomMutationQueues.get(roomId) === queued) roomMutationQueues.delete(roomId);
  }
}

export function requireBoundRoom(roomId: string): RoomRecord {
  if (typeof roomId !== 'string' || !/^room_[a-z0-9_-]{1,64}$/.test(roomId)) {
    throw new Error('Invalid Room ID.');
  }
  const currentRoom = boundRooms.get(roomId);
  if (!currentRoom) {
    throw new Error('Room is not active.');
  }
  const refreshed = bindCurrentRoom(refreshRoomRecordSync(currentRoom));
  return {
    manifest: {
      ...refreshed.manifest,
      sources: refreshed.manifest.sources.map(source => ({ ...source }))
    },
    roomRoot: refreshed.roomRoot,
    rootDevice: refreshed.rootDevice,
    rootInode: refreshed.rootInode
  };
}

export function requireBoundWorkspace(roomId: string, sourceId?: string): WorkspaceLocation {
  const room = requireBoundRoom(roomId);
  const workspace = toWorkspaceLocation(room, sourceId);
  if (workspace.sourceRoot) {
    requireBoundSource(roomId, workspace.sourceId);
  }
  return workspace;
}

export function requireBoundRoomWorkspace(roomId: string): WorkspaceLocation {
  return toRoomOnlyLocation(requireBoundRoom(roomId));
}

export function requireBoundSource(roomId: string, sourceId?: string): RoomSource {
  const room = requireBoundRoom(roomId);
  if (
    sourceId !== undefined
    && !/^source_[a-f0-9]{32}$/.test(sourceId)
  ) throw new Error('Invalid Source ID.');
  const selectedSourceId = sourceId || room.manifest.activeSourceId;
  const source = room.manifest.sources.find(item => item.id === selectedSourceId);
  if (!source) throw new Error('Attach a Source to use files, search, scan, Git, or coding actions.');
  const stat = fsSync.lstatSync(source.canonicalPath, { bigint: true });
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || fsSync.realpathSync(source.canonicalPath) !== path.resolve(source.canonicalPath)
    || stat.dev.toString() !== source.rootDevice
    || stat.ino.toString() !== source.rootInode
    || stat.birthtimeNs.toString() !== source.rootBirthtimeNs
  ) {
    throw new Error('The active Source path changed after it was attached.');
  }
  return { ...source };
}

export function requireBoundProjectRoot(roomId: string, sourceId?: string): string {
  const workspace = requireBoundWorkspace(roomId, sourceId);
  if (!workspace.sourceRoot) {
    throw new Error('Attach a Source to use files, search, scan, Git, or coding actions.');
  }
  return workspace.sourceRoot;
}

export function createSourceProvenance(
  room: RoomRecord,
  workspace: WorkspaceLocation
): SourceProvenance {
  return workspace.sourceId && workspace.sourceRoot
    ? {
        mode: 'source',
        roomId: room.manifest.id,
        sourceId: workspace.sourceId,
        sourceName: workspace.sourceName || workspace.sourceId,
        startedAt: new Date().toISOString()
      }
    : {
        mode: 'room-only',
        roomId: room.manifest.id,
        startedAt: new Date().toISOString()
      };
}

export function resolveRoomDataRoot(roomId: string): string {
  return requireBoundRoom(roomId).roomRoot;
}

export function resolveWithinRoomData(roomId: string, ...parts: string[]): string {
  const roomRoot = resolveRoomDataRoot(roomId);
  const resolved = path.resolve(roomRoot, ...parts);
  const safeRoot = roomRoot.endsWith(path.sep) ? roomRoot : `${roomRoot}${path.sep}`;
  if (resolved !== roomRoot && !resolved.startsWith(safeRoot)) {
    throw new Error('Invalid ROOM data path.');
  }
  assertNoSymlinkSegments(roomRoot, resolved);
  return resolved;
}

function assertNoSymlinkSegments(root: string, target: string): void {
  const rootStat = fsSync.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('ROOM data root must be a real directory.');
  }
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    try {
      const stat = fsSync.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error('ROOM data paths cannot contain symbolic links.');
      }
    } catch (error: unknown) {
      if (
        error
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'ENOENT'
      ) return;
      throw error;
    }
  }
}

export function resolveWithinProject(projectRoot: string, ...parts: string[]): string {
  const root = resolveProjectPath(projectRoot);
  const resolved = path.resolve(root, ...parts);
  const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(safeRoot)) {
    throw new Error('Invalid path.');
  }
  return resolved;
}

export async function resolveCanonicalWithinProject(
  projectRoot: string,
  ...parts: string[]
): Promise<string> {
  const root = resolveProjectPath(projectRoot);
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('The active Source must be a real directory.');
  }
  const resolved = resolveWithinProject(root, ...parts);
  const relativePath = path.relative(root, resolved);
  let currentPath = root;

  if (relativePath) {
    for (const segment of relativePath.split(path.sep)) {
      currentPath = path.join(currentPath, segment);
      const stat = await fs.lstat(currentPath);
      if (stat.isSymbolicLink()) {
        throw new Error('Source paths cannot contain symbolic links.');
      }
    }
  }

  const [canonicalRoot, canonicalTarget] = await Promise.all([
    fs.realpath(root),
    fs.realpath(resolved)
  ]);
  const canonicalRelativePath = path.relative(canonicalRoot, canonicalTarget);
  if (
    canonicalRelativePath === '..'
    || canonicalRelativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(canonicalRelativePath)
  ) {
    throw new Error('Source path resolves outside the active Source.');
  }

  return resolved;
}

export async function openVerifiedFileWithinProject(
  projectRoot: string,
  ...parts: string[]
): Promise<{
  handle: Awaited<ReturnType<typeof fs.open>>;
  stat: fsSync.Stats;
  resolvedPath: string;
}> {
  const root = await fs.realpath(resolveProjectPath(projectRoot));
  const resolvedPath = await resolveCanonicalWithinProject(root, ...parts);
  const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number'
    ? fsSync.constants.O_NOFOLLOW
    : 0;
  const handle = await fs.open(resolvedPath, fsSync.constants.O_RDONLY | noFollow);
  try {
    const [stat, currentPathStat, currentCanonicalPath] = await Promise.all([
      handle.stat(),
      fs.stat(resolvedPath),
      fs.realpath(resolvedPath)
    ]);
    const relative = path.relative(root, currentCanonicalPath);
    if (
      relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
      || stat.dev !== currentPathStat.dev
      || stat.ino !== currentPathStat.ino
      || !stat.isFile()
    ) {
      throw new Error('Source file changed during secure open.');
    }
    return { handle, stat, resolvedPath };
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

export function sanitizeFileName(input: string, fallback = 'untitled'): string {
  const name = path.basename(input || '').trim();
  if (!name) return fallback;
  return name;
}

export function sanitizeWorkspaceRelativePath(input: string): string {
  if (
    typeof input !== 'string'
    || !input.trim()
    || Buffer.byteLength(input, 'utf-8') > 4_096
  ) {
    throw new Error('Invalid Source file path.');
  }

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (
    !normalized
    || parts.length > 128
    || parts.some(part => (
      !part
      || part === '.'
      || part === '..'
      || part.startsWith('.')
      || IGNORED_WORKSPACE_DIRS.has(part)
      || Buffer.byteLength(part, 'utf-8') > 255
    ))
  ) {
    throw new Error('Invalid Source file path.');
  }

  return normalized;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isAllowed(value: string, allowed: readonly string[]): value is string {
  return allowed.includes(value);
}

export function sanitizeAgentFileName(name: string): string {
  const normalized = path.basename(name.toLowerCase()).trim();
  return normalized.replace(/[^a-z0-9_-]/g, '-');
}

export function isObjectWithAllowedKeys(value: unknown, allowedKeys: readonly string[]): boolean {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function safeReadDir(dirPath: string): Promise<string[]> {
  return (await safeReadDirWithStatus(dirPath)).files;
}

export async function safeReadDirWithStatus(
  dirPath: string,
  maxEntries = 1_000
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const maxInspectedEntries = Math.min(100_000, Math.max(1_000, maxEntries * 10));
  const deadline = Date.now() + 2_000;
  let inspectedEntries = 0;
  try {
    const directory = await fs.opendir(dirPath);
    try {
      for await (const entry of directory) {
        inspectedEntries += 1;
        if (inspectedEntries > maxInspectedEntries || Date.now() > deadline) {
          return { files, truncated: true };
        }
        if (entry.name.startsWith('.')) continue;
        if (files.length >= maxEntries) {
          return { files, truncated: true };
        }
        files.push(entry.name);
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
    return { files, truncated: false };
  } catch {
    return { files: [], truncated: false };
  }
}

export async function readFirstExistingFile(paths: string[]): Promise<string> {
  for (const filePath of paths) {
    try {
      return await readTextFileWithLimit(filePath, 1024 * 1024);
    } catch {}
  }
  return '';
}

export async function readRoomSkillReferences(roomId: string): Promise<string[]> {
  const references: string[] = [];
  for (const source of ['skills', 'roles'] as const) {
    const files = await safeReadDir(resolveWithinRoomData(roomId, source));
    references.push(...files
      .filter(file => file.toLowerCase().endsWith('.md'))
      .map(file => createRoomSkillReference(source, file)));
  }
  return references.sort((left, right) => left.localeCompare(right));
}

export async function readTextFileWithLimit(filePath: string, maxBytes: number): Promise<string> {
  const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number'
    ? fsSync.constants.O_NOFOLLOW
    : 0;
  const handle = await fs.open(filePath, fsSync.constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Selected item is not a file.');
    if (stat.size > maxBytes) {
      throw new Error('File is too large to include as discussion context.');
    }
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
    if (total > maxBytes) {
      throw new Error('File is too large to include as discussion context.');
    }
    const content = buffer.subarray(0, total);
    if (content.includes(0)) {
      throw new Error('Binary files cannot be included as discussion context.');
    }
    return content.toString('utf-8');
  } finally {
    await handle.close();
  }
}

export function extractMarkdownHeading(content: string): string | undefined {
  const heading = content
    .split('\n')
    .map(line => line.trim())
    .find(line => /^#{1,3}\s+\S/.test(line));
  return heading?.replace(/^#{1,3}\s+/, '').trim().slice(0, 100);
}
