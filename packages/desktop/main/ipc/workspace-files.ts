import * as path from 'path';
import * as fs from 'fs/promises';
import {
  IGNORED_WORKSPACE_DIRS,
  ROOM_DIR,
  WORKSPACE_FILE_LIMIT,
  resolveProjectPath,
  resolveCanonicalWithinProject,
  resolveWithinProject
} from './shared.js';

export interface WorkspaceFileItem {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: 'file' | 'directory';
  extension?: string;
  childCount?: number;
}

function isRoomManagedWorkspaceFile(relPath: string): boolean {
  return relPath.toLowerCase().startsWith(`${ROOM_DIR}/`);
}

export async function listWorkspaceFiles(projectRoot: string): Promise<WorkspaceFileItem[]> {
  const root = resolveProjectPath(projectRoot);
  const files: WorkspaceFileItem[] = [];

  async function walk(currentDir: string) {
    if (files.length >= WORKSPACE_FILE_LIMIT) return;

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= WORKSPACE_FILE_LIMIT) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && IGNORED_WORKSPACE_DIRS.has(entry.name)) continue;

      const fullPath = resolveWithinProject(root, path.relative(root, path.join(currentDir, entry.name)));
      const relPath = path.relative(root, fullPath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        const stat = await fs.stat(fullPath);
        files.push({
          path: relPath,
          name: entry.name,
          size: 0,
          modifiedAt: stat.mtime.toISOString(),
          kind: 'directory'
        });
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fs.stat(fullPath);
      if (isRoomManagedWorkspaceFile(relPath)) {
        continue;
      }
      files.push({
        path: relPath,
        name: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        kind: 'file',
        extension: path.extname(entry.name).slice(1).toLowerCase() || undefined
      });
    }
  }

  await walk(root);
  return files;
}

function shouldIncludeEntry(name: string, isDirectory: boolean): boolean {
  if (name.startsWith('.')) return false;
  return !isDirectory || !IGNORED_WORKSPACE_DIRS.has(name);
}

async function toWorkspaceFileItem(
  root: string,
  fullPath: string,
  entry: { name: string; isDirectory: () => boolean; isFile: () => boolean }
): Promise<WorkspaceFileItem | null> {
  if (!entry.isDirectory() && !entry.isFile()) return null;
  const relPath = path.relative(root, fullPath).split(path.sep).join('/');
  if (isRoomManagedWorkspaceFile(relPath)) return null;
  const stat = await fs.stat(fullPath);
  let childCount: number | undefined;
  if (entry.isDirectory()) {
    const children = await fs.readdir(fullPath, { withFileTypes: true });
    childCount = children.filter(child => shouldIncludeEntry(child.name, child.isDirectory())).length;
  }
  return {
    path: relPath,
    name: entry.name,
    size: entry.isDirectory() ? 0 : stat.size,
    modifiedAt: stat.mtime.toISOString(),
    kind: entry.isDirectory() ? 'directory' : 'file',
    extension: entry.isFile() ? path.extname(entry.name).slice(1).toLowerCase() || undefined : undefined,
    childCount
  };
}

export async function browseWorkspaceFiles(
  projectRoot: string,
  relativeDirectory = '',
  query = ''
): Promise<{ files: WorkspaceFileItem[]; truncated: boolean }> {
  const root = resolveProjectPath(projectRoot);
  const normalizedDirectory = relativeDirectory.trim()
    ? relativeDirectory.replace(/\\/g, '/').replace(/^\/+/, '')
    : '';
  const startDir = normalizedDirectory
    ? await resolveCanonicalWithinProject(root, normalizedDirectory)
    : root;
  const startStat = await fs.stat(startDir);
  if (!startStat.isDirectory()) {
    throw new Error('Selected workspace path is not a directory.');
  }

  const normalizedQuery = query.trim().toLowerCase();
  const limit = normalizedQuery ? WORKSPACE_FILE_LIMIT : 250;
  const scanLimit = normalizedQuery ? 2500 : limit;
  const files: WorkspaceFileItem[] = [];
  let scanned = 0;

  async function collect(currentDir: string): Promise<void> {
    if (files.length >= limit || scanned >= scanLimit) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (files.length >= limit || scanned >= scanLimit) return;
      if (!shouldIncludeEntry(entry.name, entry.isDirectory())) continue;
      scanned += 1;
      const fullPath = resolveWithinProject(root, path.relative(root, path.join(currentDir, entry.name)));
      const item = await toWorkspaceFileItem(root, fullPath, entry);
      if (!item) continue;
      if (!normalizedQuery || item.path.toLowerCase().includes(normalizedQuery)) {
        files.push(item);
      }
      if (normalizedQuery && entry.isDirectory()) {
        await collect(fullPath);
      }
    }
  }

  await collect(startDir);
  return {
    files,
    truncated: files.length >= limit || scanned >= scanLimit
  };
}
