import * as path from 'path';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import {
  isMachineSkillReference,
  toWorkspaceLocation,
  validateAgentConfig,
  type AgentConfig,
  type RoomRecord,
  type SourceProvenance,
  type WorkspaceLocation
} from '@room/engine';

export const ROOM_DIR = '.room';
export const SUPPORTED_LOCAL_CLI_PRESETS = ['claude', 'gemini', 'codex', 'copilot', 'codewhale', 'agy', 'kiro'] as const;
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

let currentRoom: RoomRecord | null = null;

export function resolveProjectPath(dirPath: string): string {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    throw new Error('Invalid path.');
  }
  return path.resolve(dirPath);
}

export function bindCurrentRoom(record: RoomRecord): RoomRecord {
  currentRoom = {
    manifest: {
      ...record.manifest,
      sources: record.manifest.sources.map(source => ({ ...source }))
    },
    roomRoot: path.resolve(record.roomRoot)
  };
  return currentRoom;
}

export function requireBoundRoom(roomId: string): RoomRecord {
  if (typeof roomId !== 'string' || !roomId.trim()) {
    throw new Error('Invalid Room ID.');
  }
  if (!currentRoom || roomId !== currentRoom.manifest.id) {
    throw new Error('Room is not active.');
  }
  return {
    manifest: {
      ...currentRoom.manifest,
      sources: currentRoom.manifest.sources.map(source => ({ ...source }))
    },
    roomRoot: currentRoom.roomRoot
  };
}

export function requireBoundWorkspace(roomId: string, sourceId?: string): WorkspaceLocation {
  const workspace = toWorkspaceLocation(requireBoundRoom(roomId), sourceId);
  if (workspace.sourceRoot) {
    const stat = fsSync.lstatSync(workspace.sourceRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('The active Source is no longer a real directory.');
    }
    if (fsSync.realpathSync(workspace.sourceRoot) !== path.resolve(workspace.sourceRoot)) {
      throw new Error('The active Source path changed after it was attached.');
    }
  }
  return workspace;
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
  const source = workspace.sourceId
    ? room.manifest.sources.find(item => item.id === workspace.sourceId)
    : undefined;
  return source
    ? { mode: 'source', sourceId: source.id, sourceName: source.name }
    : { mode: 'room-only' };
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
  return resolved;
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

export function sanitizeFileName(input: string, fallback = 'untitled'): string {
  const name = path.basename(input || '').trim();
  if (!name) return fallback;
  return name;
}

export function sanitizeWorkspaceRelativePath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Invalid Source file path.');
  }

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
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

export function normalizeTemporaryAgents(rawAgents: unknown): AgentConfig[] {
  if (!Array.isArray(rawAgents)) return [];
  return rawAgents
    .slice(0, 12)
    .map(rawAgent => validateAgentConfig(rawAgent))
    .filter((result): result is { success: true; agent: AgentConfig } => result.success)
    .map(result => ({
      ...result.agent,
      skills: (result.agent.skills || []).filter(skill => !isMachineSkillReference(skill))
    }));
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
