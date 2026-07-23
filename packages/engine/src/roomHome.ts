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
    const canonicalLegacyRoot = await resolveSafeLegacyRoot(
      legacyRoot,
      canonicalPath
    );
    const legacyContainsRoomHome = canonicalLegacyRoot
      ? isSameOrNestedPath(canonicalLegacyRoot, canonicalRoomHome)
      : false;
    if (options.importLegacy !== false && canonicalLegacyRoot && !legacyContainsRoomHome) {
      const copyStats = await copyLegacyRoomContents(
        legacyRoot,
        temporaryRoot,
        canonicalLegacyRoot
      );
      await stripImportedMachineSkillSelections(temporaryRoot);
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

async function copyLegacyRoomContents(
  sourceDir: string,
  targetDir: string,
  canonicalLegacyRoot: string
): Promise<CopyStats> {
  const stats: CopyStats = { fileCount: 0, byteCount: 0, skippedSymlinkCount: 0 };
  const sourceStat = await fs.lstat(sourceDir);
  const canonicalSourceDir = await fs.realpath(sourceDir);
  if (
    sourceStat.isSymbolicLink()
    || !sourceStat.isDirectory()
    || !isSameOrNestedPath(canonicalLegacyRoot, canonicalSourceDir)
  ) {
    throw new Error('Legacy ROOM data must remain inside the attached source.');
  }
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const entryStat = await fs.lstat(sourcePath);
    if (entry.isSymbolicLink() || entryStat.isSymbolicLink()) {
      stats.skippedSymlinkCount += 1;
      continue;
    }
    const canonicalSourcePath = await fs.realpath(sourcePath);
    if (!isSameOrNestedPath(canonicalLegacyRoot, canonicalSourcePath)) {
      throw new Error('Legacy ROOM data must remain inside the attached source.');
    }
    if (entry.isDirectory() && entryStat.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: false });
      const childStats = await copyLegacyRoomContents(
        sourcePath,
        targetPath,
        canonicalLegacyRoot
      );
      stats.fileCount += childStats.fileCount;
      stats.byteCount += childStats.byteCount;
      stats.skippedSymlinkCount += childStats.skippedSymlinkCount;
      continue;
    }
    if (!entry.isFile() || !entryStat.isFile()) continue;
    await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    stats.fileCount += 1;
    stats.byteCount += entryStat.size;
  }
  return stats;
}

async function resolveSafeLegacyRoot(
  legacyRoot: string,
  canonicalSourceRoot: string
): Promise<string | null> {
  const legacyStat = await fs.lstat(legacyRoot).catch(() => null);
  if (!legacyStat?.isDirectory() || legacyStat.isSymbolicLink()) return null;
  const canonicalLegacyRoot = await fs.realpath(legacyRoot);
  const expectedLegacyRoot = path.join(canonicalSourceRoot, '.room');
  return path.resolve(canonicalLegacyRoot) === path.resolve(expectedLegacyRoot)
    ? canonicalLegacyRoot
    : null;
}

async function stripImportedMachineSkillSelections(roomRoot: string): Promise<void> {
  for (const directoryName of ['members', 'agents']) {
    const directoryPath = path.join(roomRoot, directoryName);
    const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(directoryPath, entry.name);
      try {
        const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const agent = parsed as Record<string, unknown>;
        if (!Array.isArray(agent.skills)) continue;
        const safeSkills = agent.skills.filter(skill => (
          typeof skill !== 'string'
          || !skill.trim().toLowerCase().startsWith('machine://')
        ));
        if (safeSkills.length === agent.skills.length) continue;
        await fs.writeFile(
          filePath,
          `${JSON.stringify({ ...agent, skills: safeSkills }, null, 2)}\n`,
          'utf-8'
        );
      } catch {
        // Invalid legacy agent files remain inert and are ignored by the registry loader.
      }
    }
  }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return;
    throw error;
  }
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
