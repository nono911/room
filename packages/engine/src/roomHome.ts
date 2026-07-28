import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceLocation } from './workspace.js';
import { withRoomDataLock } from './roomDataLock.js';
import { requireStableSourceBirthtime } from './sourceIdentity.js';
import {
  findStoredSourceIdentity,
  persistSourceIdentity
} from './sourceIdentityStore.js';
import { attachSourceToManifest } from './roomSourceRegistry.js';
import { writeFileAtomically } from './atomicFile.js';
import {
  listDirectoryNamesBounded,
  readUtf8FileBounded,
  readUtf8FileBoundedSync
} from './boundedFs.js';
import { cleanupStaleRoomSidecars } from './roomSidecarCleanup.js';
import { reconcileAbandonedRunRecords } from './runRecovery.js';
import {
  assertManifestSources,
  assertManifestSourcesSync,
  isRoomSourceShape
} from './roomManifestValidation.js';
export { withRoomDataLock } from './roomDataLock.js';
const ROOM_HOME_ENV = 'ROOM_HOME';
const ROOM_SCHEMA_VERSION = 1;
const PERSONAL_ROOM_ID = 'room_personal';
const ROOM_MANIFEST_MAX_BYTES = 256 * 1024;
const MAX_ROOM_SOURCES = 64;
const MAX_DETACHED_SOURCES = 256;
const MAX_ROOMS = 100;
const roomMutationLocks = new Map<string, Promise<void>>();
export interface RoomSource {
  id: string;
  type: 'directory';
  name: string;
  path: string;
  canonicalPath: string;
  rootDevice: string;
  rootInode: string;
  rootBirthtimeNs: string;
  attachedAt: string;
}
export interface RoomManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  sources: RoomSource[];
  detachedSources?: RoomSource[];
  activeSourceId?: string;
}
export interface RoomRecord {
  manifest: RoomManifest;
  roomRoot: string;
  rootDevice?: string;
  rootInode?: string;
}
export function resolveRoomHome(explicitHome?: string): string {
  const configured = explicitHome || process.env[ROOM_HOME_ENV];
  const home = path.resolve(configured?.trim() || path.join(os.homedir(), '.room'));
  if (home === path.parse(home).root) {
    throw new Error('ROOM Home cannot be a filesystem root.');
  }
  return home;
}
export function toWorkspaceLocation(
  record: RoomRecord,
  sourceId = record.manifest.activeSourceId
): WorkspaceLocation {
  const source = sourceId
    ? record.manifest.sources.find(candidate => candidate.id === sourceId)
    : undefined;
  if (sourceId && !source) {
    throw new Error(`Source ${sourceId} is not attached to Room ${record.manifest.id}.`);
  }
  return {
    roomId: record.manifest.id,
    roomRoot: record.roomRoot,
    sourceRoot: source?.canonicalPath,
    sourceId: source?.id,
    sourceName: source?.name
  };
}

export function toRoomOnlyLocation(record: RoomRecord): WorkspaceLocation {
  return {
    roomId: record.manifest.id,
    roomRoot: record.roomRoot
  };
}

export async function ensurePersonalRoom(roomHome?: string): Promise<RoomRecord> {
  const home = resolveRoomHome(roomHome);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  await assertManagedDirectory(home);
  const roomsRoot = path.join(home, 'rooms');
  await ensureManagedDirectory(roomsRoot);
  const roomRoot = path.join(home, 'rooms', PERSONAL_ROOM_ID);
  await ensureManagedDirectory(roomRoot);
  const record = await withRoomDataLock(roomRoot, 'manifest', async () => {
    const existing = await readRoomManifest(roomRoot);
    if (existing) {
      await initializeRoomData(roomRoot);
      await cleanupStaleRoomSidecars(roomRoot);
      return { manifest: existing, roomRoot };
    }

    const now = new Date().toISOString();
    const manifest: RoomManifest = {
      schemaVersion: ROOM_SCHEMA_VERSION,
      id: PERSONAL_ROOM_ID,
      name: 'Personal Room',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      sources: [],
      detachedSources: []
    };
    await initializeRoomData(roomRoot);
    await writeRoomManifest(roomRoot, manifest);
    await cleanupStaleRoomSidecars(roomRoot);
    return { manifest, roomRoot };
  });
  await reconcileAbandonedRunRecords(record);
  return record;
}
export async function getRoomById(roomId: string, roomHome?: string): Promise<RoomRecord | null> {
  if (!isRoomId(roomId)) return null;
  const roomRoot = path.join(resolveRoomHome(roomHome), 'rooms', roomId);
  const manifest = await readRoomManifest(roomRoot);
  return manifest ? { manifest, roomRoot } : null;
}
export function refreshRoomRecordSync(record: RoomRecord): RoomRecord {
  const roomRoot = path.resolve(record.roomRoot);
  const rootStat = fsSync.lstatSync(roomRoot, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`ROOM managed path must be a real directory: ${roomRoot}`);
  }
  if (
    typeof process.getuid === 'function'
    && rootStat.uid !== BigInt(process.getuid())
  ) {
    throw new Error(`ROOM managed path must be owned by the current user: ${roomRoot}`);
  }
  if (
    (record.rootDevice && record.rootDevice !== rootStat.dev.toString())
    || (record.rootInode && record.rootInode !== rootStat.ino.toString())
  ) {
    throw new Error(`ROOM managed path changed after it was opened: ${roomRoot}`);
  }
  const value = JSON.parse(readUtf8FileBoundedSync(
    path.join(roomRoot, 'room.json'),
    ROOM_MANIFEST_MAX_BYTES
  )) as unknown;
  if (!isRoomManifest(value) || value.id !== record.manifest.id) {
    throw new Error(`Room ${record.manifest.id} is unavailable.`);
  }
  assertManifestSourcesSync(value, roomRoot);
  return {
    manifest: value,
    roomRoot,
    rootDevice: rootStat.dev.toString(),
    rootInode: rootStat.ino.toString()
  };
}
export async function listRooms(roomHome?: string): Promise<RoomRecord[]> {
  const roomsRoot = path.join(resolveRoomHome(roomHome), 'rooms');
  const entries = await listDirectoryNamesBounded(roomsRoot, MAX_ROOMS)
    .then(result => result.names)
    .catch(() => []);
  const records: RoomRecord[] = [];
  for (const entry of entries) {
    if (!isRoomId(entry)) continue;
    const roomRoot = path.join(roomsRoot, entry);
    const manifest = await readRoomManifest(roomRoot);
    if (manifest) records.push({ manifest, roomRoot });
  }
  return records.sort((a, b) => b.manifest.lastOpenedAt.localeCompare(a.manifest.lastOpenedAt));
}
export async function attachRoomSource(
  record: RoomRecord,
  sourcePath: string,
  name?: string
): Promise<RoomRecord> {
  const resolvedPath = path.resolve(sourcePath);
  const stat = await fs.stat(resolvedPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('The source must be an existing directory.');

  const canonicalPath = await fs.realpath(resolvedPath);
  if (canonicalPath === path.parse(canonicalPath).root) {
    throw new Error('A filesystem root cannot be attached as a source.');
  }
  const recordRoomHome = path.dirname(path.dirname(record.roomRoot));
  const canonicalRoomHome = await fs.realpath(recordRoomHome).catch(() => recordRoomHome);
  if (
    isSameOrNestedPath(canonicalRoomHome, canonicalPath)
    || isSameOrNestedPath(canonicalPath, canonicalRoomHome)
  ) {
    throw new Error('A Source cannot overlap ROOM Home.');
  }
  const rootStat = await fs.lstat(canonicalPath, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('The source must be a real directory.');
  }
  requireStableSourceBirthtime(rootStat.birthtimeNs);
  return mutateRoomManifestAsync(record, async manifest => {
    const storedIdentity = await findStoredSourceIdentity(
      manifest.id,
      record.roomRoot,
      rootStat.dev.toString(),
      rootStat.ino.toString(),
      rootStat.birthtimeNs.toString()
    );
    return attachSourceToManifest(manifest, {
      name,
      resolvedPath,
      canonicalPath,
      rootDevice: rootStat.dev.toString(),
      rootInode: rootStat.ino.toString(),
      rootBirthtimeNs: rootStat.birthtimeNs.toString(),
      storedIdentity
    });
  }, async updated => {
    const attached = updated.sources.find(source => source.id === updated.activeSourceId)!;
    await persistSourceIdentity(updated.id, record.roomRoot, attached);
  });
}
export async function setActiveRoomSource(
  record: RoomRecord,
  sourceId?: string
): Promise<RoomRecord> {
  return mutateRoomManifest(record, manifest => {
    if (sourceId && !manifest.sources.some(source => source.id === sourceId)) {
      throw new Error(`Source ${sourceId} is not attached to Room ${manifest.id}.`);
    }
    const now = new Date().toISOString();
    const updated: RoomManifest = {
      ...manifest,
      activeSourceId: sourceId,
      updatedAt: now,
      lastOpenedAt: now
    };
    if (!sourceId) delete updated.activeSourceId;
    return updated;
  });
}
export async function detachRoomSource(
  record: RoomRecord,
  sourceId: string
): Promise<RoomRecord> {
  return mutateRoomManifest(record, manifest => {
    const detachedSource = manifest.sources.find(source => source.id === sourceId);
    const sources = manifest.sources.filter(source => source.id !== sourceId);
    if (sources.length === manifest.sources.length) {
      throw new Error(`Source ${sourceId} is not attached to Room ${manifest.id}.`);
    }
    const now = new Date().toISOString();
    const updated: RoomManifest = {
      ...manifest,
      sources,
      detachedSources: [
        ...(manifest.detachedSources || []).filter(source => source.id !== sourceId),
        detachedSource!
      ].slice(-MAX_DETACHED_SOURCES),
      updatedAt: now,
      lastOpenedAt: now
    };
    if (updated.activeSourceId === sourceId) delete updated.activeSourceId;
    return updated;
  });
}
export async function touchRoom(record: RoomRecord): Promise<RoomRecord> {
  return mutateRoomManifest(record, manifest => {
    const now = new Date().toISOString();
    return { ...manifest, updatedAt: now, lastOpenedAt: now };
  });
}
export async function ensureRoomSystemDirectory(roomHome?: string): Promise<string> {
  const home = resolveRoomHome(roomHome);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  await assertManagedDirectory(home);
  const systemRoot = path.join(home, 'system');
  await ensureManagedDirectory(systemRoot);
  await cleanupStaleRoomSidecars(systemRoot);
  return systemRoot;
}
export async function initializeRoomData(roomRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(roomRoot);
  await ensureManagedDirectory(resolvedRoot);
  await Promise.all([
    'context',
    'tasks',
    'discussions',
    'documents',
    'decisions',
    'reviews',
    'skills',
    'roles',
    'members',
    'teams',
    'strategies',
    'sources',
    'runs'
  ].map(directory => ensureManagedDirectory(path.join(resolvedRoot, directory))));
  await writeFileIfMissing(
    path.join(resolvedRoot, 'context', 'overview.md'),
    '# Personal Room\n\n## Overview\nYour source-independent ROOM memory.\n\n## Goals\n- \n\n## Open Questions\n- \n'
  );
  await writeFileIfMissing(
    path.join(resolvedRoot, 'context', 'structure.md'),
    '# Room Structure\n\nAttach a Source when you want ROOM to inspect Source files or run coding tools.\n'
  );
}
async function readRoomManifest(roomRoot: string): Promise<RoomManifest | null> {
  try {
    await assertManagedDirectory(roomRoot);
    const manifestPath = path.join(roomRoot, 'room.json');
    const value = JSON.parse(await readUtf8FileBounded(
      manifestPath,
      ROOM_MANIFEST_MAX_BYTES
    )) as unknown;
    if (!isRoomManifest(value)) {
      throw new Error(`ROOM manifest is invalid or uses an unsupported schema: ${manifestPath}`);
    }
    await assertManifestSources(value, roomRoot);
    return value;
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    return null;
  }
}
async function writeRoomManifest(roomRoot: string, manifest: RoomManifest): Promise<void> {
  const serialized = serializeRoomManifest(manifest);
  // Fail the write rather than persisting a manifest the reader would reject —
  // an unreadable room.json locks the Room out with no in-app repair path.
  assertManifestSourcesSync(manifest, roomRoot);
  await writeFileAtomically(path.join(roomRoot, 'room.json'), serialized);
}

function serializeRoomManifest(manifest: RoomManifest): string {
  if (!isRoomManifest(manifest)) throw new Error('ROOM manifest exceeds its schema limits.');
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf-8') > ROOM_MANIFEST_MAX_BYTES) {
    throw new Error('ROOM manifest exceeds its storage limit.');
  }
  return serialized;
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return;
    throw error;
  }
}

function isRoomManifest(value: unknown): value is RoomManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== ROOM_SCHEMA_VERSION
    || !isRoomId(manifest.id)
    || !isBoundedText(manifest.name, 256)
    || !isBoundedText(manifest.createdAt, 64)
    || !isBoundedText(manifest.updatedAt, 64)
    || !isBoundedText(manifest.lastOpenedAt, 64)
    || !Array.isArray(manifest.sources)
    || manifest.sources.length > MAX_ROOM_SOURCES
    || (
      manifest.detachedSources !== undefined
      && (
        !Array.isArray(manifest.detachedSources)
        || manifest.detachedSources.length > MAX_DETACHED_SOURCES
      )
    )
    || (
      manifest.activeSourceId !== undefined
      && (
        !isBoundedText(manifest.activeSourceId, 80)
        || !/^source_[a-f0-9]{32}$/.test(manifest.activeSourceId)
      )
    )
  ) return false;
  const sourcesValid = [
    ...manifest.sources,
    ...(manifest.detachedSources || [])
  ].every(isRoomSourceShape);
  return sourcesValid && (
    manifest.activeSourceId === undefined
    || manifest.sources.some(source => (
      source
      && typeof source === 'object'
      && !Array.isArray(source)
      && (source as Record<string, unknown>).id === manifest.activeSourceId
    ))
  );
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf-8') > 0
    && Buffer.byteLength(value, 'utf-8') <= maxBytes;
}

function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && /^room_[a-z0-9_-]{1,64}$/.test(value);
}

function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function ensureManagedDirectory(directoryPath: string): Promise<void> {
  try {
    await assertManagedDirectory(directoryPath);
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    try {
      await fs.mkdir(directoryPath, { mode: 0o700 });
    } catch (mkdirError: unknown) {
      if (!hasErrorCode(mkdirError, 'EEXIST')) throw mkdirError;
    }
    await assertManagedDirectory(directoryPath);
  }
}

async function assertManagedDirectory(directoryPath: string): Promise<void> {
  const stat = await fs.lstat(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`ROOM managed path must be a real directory: ${directoryPath}`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`ROOM managed path must be owned by the current user: ${directoryPath}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    await fs.chmod(directoryPath, 0o700);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function mutateRoomManifest(
  record: RoomRecord,
  mutate: (manifest: RoomManifest) => RoomManifest
): Promise<RoomRecord> {
  return mutateRoomManifestAsync(record, async manifest => mutate(manifest));
}

async function mutateRoomManifestAsync(
  record: RoomRecord,
  mutate: (manifest: RoomManifest) => Promise<RoomManifest>,
  beforeWrite?: (manifest: RoomManifest) => Promise<void>
): Promise<RoomRecord> {
  return withRoomMutationLock(record.roomRoot, async () => {
    const current = await readRoomManifest(record.roomRoot);
    if (!current || current.id !== record.manifest.id) {
      throw new Error(`Room ${record.manifest.id} is unavailable.`);
    }
    const manifest = await mutate(current);
    const serialized = serializeRoomManifest(manifest);
    await beforeWrite?.(manifest);
    await writeFileAtomically(path.join(record.roomRoot, 'room.json'), serialized);
    return { roomRoot: record.roomRoot, manifest };
  });
}

async function withRoomMutationLock<T>(roomRoot: string, run: () => Promise<T>): Promise<T> {
  const key = path.resolve(roomRoot);
  const previous = roomMutationLocks.get(key) || Promise.resolve();
  let release = (): void => {};
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  roomMutationLocks.set(key, queued);
  await previous;
  try {
    return await withRoomDataLock(key, 'manifest', run);
  } finally {
    release();
    if (roomMutationLocks.get(key) === queued) roomMutationLocks.delete(key);
  }
}
