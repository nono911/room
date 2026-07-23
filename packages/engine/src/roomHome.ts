import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceLocation } from './workspace.js';

const ROOM_HOME_ENV = 'ROOM_HOME';
const WORKSPACE_SCHEMA_VERSION = 1;

export interface RoomWorkspaceSource {
  id: string;
  type: 'directory';
  path: string;
  canonicalPath: string;
}

export interface LegacyImportRecord {
  source: string;
  importedAt: string;
  fileCount: number;
  byteCount: number;
  skippedSymlinkCount: number;
}

export interface RoomWorkspaceManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  sources: RoomWorkspaceSource[];
  legacyImport?: LegacyImportRecord;
}

export interface RoomWorkspaceRecord {
  manifest: RoomWorkspaceManifest;
  roomRoot: string;
}

export interface CreateRoomWorkspaceOptions {
  sourceRoot: string;
  name?: string;
  roomHome?: string;
  importLegacy?: boolean;
}

interface CopyStats {
  fileCount: number;
  byteCount: number;
  skippedSymlinkCount: number;
}

export function resolveRoomHome(explicitHome?: string): string {
  const configured = explicitHome || process.env[ROOM_HOME_ENV];
  return path.resolve(configured?.trim() || path.join(os.homedir(), '.room'));
}

export function toWorkspaceLocation(record: RoomWorkspaceRecord): WorkspaceLocation {
  const primarySource = record.manifest.sources[0];
  if (!primarySource) {
    throw new Error(`ROOM workspace ${record.manifest.id} has no attached source.`);
  }
  return {
    sourceRoot: primarySource.path,
    roomRoot: record.roomRoot
  };
}

export async function initializeRoomData(roomRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(roomRoot);
  await fs.mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  const subdirs = [
    'context',
    'tasks',
    'discussions',
    'documents',
    'decisions',
    'reviews',
    'skills',
    'members',
    'teams',
    'strategies'
  ];
  await Promise.all(subdirs.map(dir => fs.mkdir(path.join(resolvedRoot, dir), { recursive: true })));

  await writeFileIfMissing(
    path.join(resolvedRoot, 'context', 'overview.md'),
    '# Workspace Name\n\n## Overview\nDescribe what this workspace is for.\n\n## Goals\n- \n\n## Source Material\n- \n\n## Open Questions\n- \n'
  );
  await writeFileIfMissing(
    path.join(resolvedRoot, 'context', 'structure.md'),
    '# Workspace Structure\n\n## Overview\nDescribe the important parts of this workspace and how they relate to each other.\n\n## Key Areas\n- \n'
  );
}

export async function listRoomWorkspaces(roomHome?: string): Promise<RoomWorkspaceRecord[]> {
  const workspacesRoot = path.join(resolveRoomHome(roomHome), 'workspaces');
  const entries = await fs.readdir(workspacesRoot, { withFileTypes: true }).catch(() => []);
  const records: RoomWorkspaceRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const roomRoot = path.join(workspacesRoot, entry.name);
    const manifest = await readWorkspaceManifest(roomRoot);
    if (manifest) {
      records.push({ manifest, roomRoot });
    }
  }

  return records.sort((a, b) =>
    b.manifest.lastOpenedAt.localeCompare(a.manifest.lastOpenedAt)
    || a.manifest.name.localeCompare(b.manifest.name)
  );
}

export async function findRoomWorkspaceBySource(
  sourceRoot: string,
  roomHome?: string
): Promise<RoomWorkspaceRecord | null> {
  const resolvedSource = path.resolve(sourceRoot);
  const canonicalSource = await fs.realpath(resolvedSource).catch(() => resolvedSource);
  const records = await listRoomWorkspaces(roomHome);
  return records.find(record => record.manifest.sources.some(source =>
    path.resolve(source.path) === resolvedSource
    || path.resolve(source.canonicalPath) === canonicalSource
  )) || null;
}

export async function createRoomWorkspace(
  options: CreateRoomWorkspaceOptions
): Promise<{ record: RoomWorkspaceRecord; created: boolean }> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const sourceStat = await fs.stat(sourceRoot).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error('The attached source must be an existing directory.');
  }

  const roomHome = resolveRoomHome(options.roomHome);
  const canonicalPath = await fs.realpath(sourceRoot);
  const canonicalRoomHome = await fs.realpath(roomHome).catch(() => roomHome);
  if (isSameOrNestedPath(canonicalRoomHome, canonicalPath)) {
    throw new Error('A ROOM Home directory cannot be attached as a workspace source.');
  }
  const existing = await findRoomWorkspaceBySource(sourceRoot, roomHome);
  if (existing) {
    const record = await touchRoomWorkspace(existing);
    return { record, created: false };
  }
  const workspaceId = `ws_${randomUUID().replace(/-/g, '')}`;
  const workspacesRoot = path.join(roomHome, 'workspaces');
  const roomRoot = path.join(workspacesRoot, workspaceId);
  const temporaryRoot = path.join(workspacesRoot, `.${workspaceId}.${randomUUID()}.tmp`);
  const now = new Date().toISOString();
  const manifest: RoomWorkspaceManifest = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: workspaceId,
    name: options.name?.trim() || path.basename(sourceRoot),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    sources: [{
      id: 'source_main',
      type: 'directory',
      path: sourceRoot,
      canonicalPath
    }]
  };

  await fs.mkdir(workspacesRoot, { recursive: true, mode: 0o700 });
  await fs.mkdir(temporaryRoot, { recursive: false, mode: 0o700 });
  try {
    const legacyRoot = path.join(sourceRoot, '.room');
    const canonicalLegacyRoot = await fs.realpath(legacyRoot).catch(() => legacyRoot);
    const legacyContainsRoomHome = isSameOrNestedPath(canonicalLegacyRoot, canonicalRoomHome);
    if (options.importLegacy !== false && !legacyContainsRoomHome && await isDirectory(legacyRoot)) {
      const copyStats = await copyLegacyRoomContents(legacyRoot, temporaryRoot);
      manifest.legacyImport = {
        source: legacyRoot,
        importedAt: now,
        ...copyStats
      };
    }

    await initializeRoomData(temporaryRoot);
    await writeWorkspaceManifest(temporaryRoot, manifest);
    await fs.rename(temporaryRoot, roomRoot);
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    record: { manifest, roomRoot },
    created: true
  };
}

export async function touchRoomWorkspace(record: RoomWorkspaceRecord): Promise<RoomWorkspaceRecord> {
  const now = new Date().toISOString();
  const manifest: RoomWorkspaceManifest = {
    ...record.manifest,
    updatedAt: now,
    lastOpenedAt: now
  };
  await writeWorkspaceManifest(record.roomRoot, manifest);
  return { ...record, manifest };
}

async function readWorkspaceManifest(roomRoot: string): Promise<RoomWorkspaceManifest | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(roomRoot, 'workspace.json'), 'utf-8')) as unknown;
    if (!isRoomWorkspaceManifest(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeWorkspaceManifest(roomRoot: string, manifest: RoomWorkspaceManifest): Promise<void> {
  const manifestPath = path.join(roomRoot, 'workspace.json');
  const temporaryPath = path.join(roomRoot, `.workspace.${randomUUID()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(temporaryPath, manifestPath);
}

async function copyLegacyRoomContents(sourceDir: string, targetDir: string): Promise<CopyStats> {
  const stats: CopyStats = { fileCount: 0, byteCount: 0, skippedSymlinkCount: 0 };
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) {
      stats.skippedSymlinkCount += 1;
      continue;
    }
    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: false });
      const childStats = await copyLegacyRoomContents(sourcePath, targetPath);
      stats.fileCount += childStats.fileCount;
      stats.byteCount += childStats.byteCount;
      stats.skippedSymlinkCount += childStats.skippedSymlinkCount;
      continue;
    }
    if (!entry.isFile()) continue;
    const fileStat = await fs.stat(sourcePath);
    await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    stats.fileCount += 1;
    stats.byteCount += fileStat.size;
  }
  return stats;
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return;
    throw error;
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  return fs.stat(dirPath).then(stat => stat.isDirectory()).catch(() => false);
}

function isRoomWorkspaceManifest(value: unknown): value is RoomWorkspaceManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== WORKSPACE_SCHEMA_VERSION
    || typeof manifest.id !== 'string'
    || !/^ws_[a-f0-9]{32}$/.test(manifest.id)
    || typeof manifest.name !== 'string'
    || typeof manifest.createdAt !== 'string'
    || typeof manifest.updatedAt !== 'string'
    || typeof manifest.lastOpenedAt !== 'string'
    || !Array.isArray(manifest.sources)
  ) {
    return false;
  }
  return manifest.sources.every(source => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
    const item = source as Record<string, unknown>;
    return typeof item.id === 'string'
      && item.type === 'directory'
      && typeof item.path === 'string'
      && typeof item.canonicalPath === 'string';
  });
}

function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
