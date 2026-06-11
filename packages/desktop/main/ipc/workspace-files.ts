import * as path from 'path';
import * as fs from 'fs/promises';
import {
  IGNORED_WORKSPACE_DIRS,
  ROOM_DIR,
  WORKSPACE_FILE_LIMIT,
  resolveProjectPath,
  resolveWithinProject
} from './shared.js';

export interface WorkspaceFileItem {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: 'file' | 'directory';
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
      if (entry.name.startsWith('.') && entry.name !== ROOM_DIR) continue;
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
        kind: 'file'
      });
    }
  }

  await walk(root);
  return files;
}
