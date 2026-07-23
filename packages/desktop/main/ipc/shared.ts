import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkspaceLocation } from '@room/engine';

export const ROOM_DIR = '.room';
export const SUPPORTED_LOCAL_CLI_PRESETS = ['claude', 'gemini', 'codex', 'copilot', 'codewhale', 'agy'] as const;
export const SUPPORTED_LOCAL_CLI_PRESETS_SET = new Set<string>(SUPPORTED_LOCAL_CLI_PRESETS);
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

let currentWorkspace: WorkspaceLocation | null = null;

export function resolveProjectPath(dirPath: string): string {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    throw new Error('Invalid project path.');
  }
  return path.resolve(dirPath);
}

export function bindCurrentProjectRoot(dirPath: string): string {
  const projectRoot = resolveProjectPath(dirPath);
  currentWorkspace = {
    sourceRoot: projectRoot,
    roomRoot: path.join(projectRoot, ROOM_DIR)
  };
  return projectRoot;
}

export function bindCurrentWorkspace(workspace: WorkspaceLocation): WorkspaceLocation {
  currentWorkspace = {
    sourceRoot: resolveProjectPath(workspace.sourceRoot),
    roomRoot: path.resolve(workspace.roomRoot)
  };
  return currentWorkspace;
}

export function requireBoundWorkspace(dirPath: string): WorkspaceLocation {
  const projectRoot = resolveProjectPath(dirPath);
  if (!currentWorkspace || projectRoot !== currentWorkspace.sourceRoot) {
    throw new Error('Project path is not the active workspace source.');
  }
  return { ...currentWorkspace };
}

export function requireBoundProjectRoot(dirPath: string): string {
  return requireBoundWorkspace(dirPath).sourceRoot;
}

export function resolveRoomDataRoot(projectRoot: string): string {
  const resolvedProjectRoot = resolveProjectPath(projectRoot);
  if (currentWorkspace?.sourceRoot === resolvedProjectRoot) {
    return currentWorkspace.roomRoot;
  }
  return path.join(resolvedProjectRoot, ROOM_DIR);
}

export function resolveWithinRoomData(projectRoot: string, ...parts: string[]): string {
  const roomRoot = resolveRoomDataRoot(projectRoot);
  const resolved = path.resolve(roomRoot, ...parts);
  const safeRoot = roomRoot.endsWith(path.sep) ? roomRoot : `${roomRoot}${path.sep}`;
  if (resolved !== roomRoot && !resolved.startsWith(safeRoot)) {
    throw new Error('Invalid ROOM data path.');
  }
  return resolved;
}

export function resolveWithinProject(projectRoot: string, ...parts: string[]): string {
  const root = resolveProjectPath(projectRoot);
  const resolved = path.resolve(root, ...parts);
  const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(safeRoot)) {
    throw new Error('Invalid project path.');
  }
  return resolved;
}

export function sanitizeFileName(input: string, fallback = 'untitled'): string {
  const name = path.basename(input || '').trim();
  if (!name) return fallback;
  return name;
}

export function sanitizeWorkspaceRelativePath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Invalid workspace file path.');
  }

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid workspace file path.');
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
  try {
    const files = await fs.readdir(dirPath);
    return files.filter(f => !f.startsWith('.'));
  } catch {
    return [];
  }
}

export async function readFirstExistingFile(paths: string[]): Promise<string> {
  for (const filePath of paths) {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {}
  }
  return '';
}

export async function readMergedDirs(dirs: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of dirs) {
    const files = await safeReadDir(dir);
    for (const file of files) {
      names.add(file);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export async function readTextFileWithLimit(filePath: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('Selected item is not a file.');
  }
  if (stat.size > maxBytes) {
    throw new Error('File is too large to include as discussion context.');
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) {
    throw new Error('Binary files cannot be included as discussion context.');
  }
  return buffer.toString('utf-8');
}

export function extractMarkdownHeading(content: string): string | undefined {
  const heading = content
    .split('\n')
    .map(line => line.trim())
    .find(line => /^#{1,3}\s+\S/.test(line));
  return heading?.replace(/^#{1,3}\s+/, '').trim().slice(0, 100);
}
