import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceLocation } from './workspace.js';

const ROOM_HOME_ENV = 'ROOM_HOME';
const ROOM_SCHEMA_VERSION = 1;
const PERSONAL_ROOM_ID = 'room_personal';

export interface RoomSource {
  id: string;
  type: 'directory';
  name: string;
  path: string;
  canonicalPath: string;
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
  activeSourceId?: string;
}

export interface RoomRecord {
  manifest: RoomManifest;
  roomRoot: string;
}

export function resolveRoomHome(explicitHome?: string): string {
  const configured = explicitHome || process.env[ROOM_HOME_ENV];
  return path.resolve(configured?.trim() || path.join(os.homedir(), '.room'));
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
    roomRoot: record.roomRoot,
    sourceRoot: source?.canonicalPath,
    sourceId: source?.id
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
  const existing = await readRoomManifest(roomRoot);
  if (existing) {
    await initializeRoomData(roomRoot);
    return touchRoom({ manifest: existing, roomRoot });
  }

  const now = new Date().toISOString();
  const manifest: RoomManifest = {
    schemaVersion: ROOM_SCHEMA_VERSION,
    id: PERSONAL_ROOM_ID,
    name: 'Personal Room',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    sources: []
  };
  await initializeRoomData(roomRoot);
  await writeRoomManifest(roomRoot, manifest);
  return { manifest, roomRoot };
}

export async function getRoomById(roomId: string, roomHome?: string): Promise<RoomRecord | null> {
  if (!isRoomId(roomId)) return null;
  const roomRoot = path.join(resolveRoomHome(roomHome), 'rooms', roomId);
  const manifest = await readRoomManifest(roomRoot);
  return manifest ? { manifest, roomRoot } : null;
}

export async function listRooms(roomHome?: string): Promise<RoomRecord[]> {
  const roomsRoot = path.join(resolveRoomHome(roomHome), 'rooms');
  const entries = await fs.readdir(roomsRoot, { withFileTypes: true }).catch(() => []);
  const records: RoomRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isRoomId(entry.name)) continue;
    const roomRoot = path.join(roomsRoot, entry.name);
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
  if (isSameOrNestedPath(canonicalRoomHome, canonicalPath)) {
    throw new Error('ROOM Home cannot be attached as a source.');
  }

  const existing = record.manifest.sources.find(source => source.canonicalPath === canonicalPath);
  const now = new Date().toISOString();
  const source: RoomSource = existing || {
    id: `source_${randomUUID().replace(/-/g, '')}`,
    type: 'directory',
    name: name?.trim() || path.basename(canonicalPath),
    path: resolvedPath,
    canonicalPath,
    attachedAt: now
  };
  const manifest: RoomManifest = {
    ...record.manifest,
    sources: existing ? record.manifest.sources : [...record.manifest.sources, source],
    activeSourceId: source.id,
    updatedAt: now,
    lastOpenedAt: now
  };
  await writeRoomManifest(record.roomRoot, manifest);
  return { ...record, manifest };
}

export async function setActiveRoomSource(
  record: RoomRecord,
  sourceId?: string
): Promise<RoomRecord> {
  if (sourceId && !record.manifest.sources.some(source => source.id === sourceId)) {
    throw new Error(`Source ${sourceId} is not attached to Room ${record.manifest.id}.`);
  }
  const now = new Date().toISOString();
  const manifest: RoomManifest = {
    ...record.manifest,
    activeSourceId: sourceId,
    updatedAt: now,
    lastOpenedAt: now
  };
  if (!sourceId) delete manifest.activeSourceId;
  await writeRoomManifest(record.roomRoot, manifest);
  return { ...record, manifest };
}

export async function detachRoomSource(
  record: RoomRecord,
  sourceId: string
): Promise<RoomRecord> {
  const sources = record.manifest.sources.filter(source => source.id !== sourceId);
  if (sources.length === record.manifest.sources.length) {
    throw new Error(`Source ${sourceId} is not attached to Room ${record.manifest.id}.`);
  }
  const now = new Date().toISOString();
  const manifest: RoomManifest = {
    ...record.manifest,
    sources,
    updatedAt: now,
    lastOpenedAt: now
  };
  if (manifest.activeSourceId === sourceId) delete manifest.activeSourceId;
  await writeRoomManifest(record.roomRoot, manifest);
  return { ...record, manifest };
}

export async function touchRoom(record: RoomRecord): Promise<RoomRecord> {
  const now = new Date().toISOString();
  const manifest = { ...record.manifest, updatedAt: now, lastOpenedAt: now };
  await writeRoomManifest(record.roomRoot, manifest);
  return { ...record, manifest };
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
    'members',
    'teams',
    'strategies',
    'system'
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
    const manifestStat = await fs.lstat(manifestPath);
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
      throw new Error(`ROOM manifest must be a real file: ${manifestPath}`);
    }
    const value = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as unknown;
    return isRoomManifest(value) ? value : null;
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    return null;
  }
}

async function writeRoomManifest(roomRoot: string, manifest: RoomManifest): Promise<void> {
  const temporaryPath = path.join(roomRoot, `.room.${randomUUID()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  });
  await fs.rename(temporaryPath, path.join(roomRoot, 'room.json'));
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
    || typeof manifest.name !== 'string'
    || typeof manifest.createdAt !== 'string'
    || typeof manifest.updatedAt !== 'string'
    || typeof manifest.lastOpenedAt !== 'string'
    || !Array.isArray(manifest.sources)
    || (manifest.activeSourceId !== undefined && typeof manifest.activeSourceId !== 'string')
  ) return false;
  const sourcesValid = manifest.sources.every(source => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
    const item = source as Record<string, unknown>;
    return typeof item.id === 'string'
      && item.type === 'directory'
      && typeof item.name === 'string'
      && typeof item.path === 'string'
      && typeof item.canonicalPath === 'string'
      && typeof item.attachedAt === 'string';
  });
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
    await fs.mkdir(directoryPath, { mode: 0o700 });
    await assertManagedDirectory(directoryPath);
  }
}

async function assertManagedDirectory(directoryPath: string): Promise<void> {
  const stat = await fs.lstat(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`ROOM managed path must be a real directory: ${directoryPath}`);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
