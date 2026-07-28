import * as path from 'path';
import * as fs from 'fs';

export interface WorkspaceLocation {
  roomId: string;
  sourceRoot?: string;
  sourceId?: string;
  sourceName?: string;
  roomRoot: string;
}

export type WorkspaceInput = WorkspaceLocation;

export function resolveWorkspaceLocation(input: WorkspaceInput): WorkspaceLocation {
  if (!input || typeof input !== 'object') {
    throw new Error('Room location must use a Room ID and Room data root.');
  }
  if (!/^room_[a-z0-9_-]{1,64}$/.test(input.roomId)) {
    throw new Error('Invalid Room ID.');
  }
  if (typeof input.roomRoot !== 'string' || !path.isAbsolute(input.roomRoot)) {
    throw new Error('Room data root must be an absolute path.');
  }
  const hasSourceIdentity = input.sourceId !== undefined || input.sourceRoot !== undefined;
  if (
    hasSourceIdentity
    && (
      !input.sourceId
      || !/^source_[a-f0-9]{32}$/.test(input.sourceId)
      || !input.sourceRoot
      || !path.isAbsolute(input.sourceRoot)
    )
  ) {
    throw new Error('Source ID and absolute Source root must be provided together.');
  }
  return {
    sourceRoot: input.sourceRoot ? path.resolve(input.sourceRoot) : undefined,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    roomId: input.roomId,
    roomRoot: path.resolve(input.roomRoot)
  };
}

export function resolveRoomPath(input: WorkspaceInput, ...parts: string[]): string {
  const roomRoot = resolveWorkspaceLocation(input).roomRoot;
  const resolved = path.resolve(roomRoot, ...parts);
  assertContainedPath(roomRoot, resolved, 'Room');
  return resolved;
}

export function resolveExecutionRoot(input: WorkspaceInput): string {
  const workspace = resolveWorkspaceLocation(input);
  return workspace.sourceRoot || workspace.roomRoot;
}

export function resolveSourceStatePath(input: WorkspaceInput, ...parts: string[]): string {
  const workspace = resolveWorkspaceLocation(input);
  if (!workspace.sourceId || !/^source_[a-f0-9]{32}$/.test(workspace.sourceId)) {
    throw new Error('An attached Source ID is required for Source-derived Room data.');
  }
  const resolved = path.resolve(workspace.roomRoot, 'sources', workspace.sourceId, ...parts);
  assertContainedPath(workspace.roomRoot, resolved, 'Room');
  return resolved;
}

function assertContainedPath(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} data path escapes its root.`);
  }
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`${label} data paths cannot contain symbolic links.`);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    current = path.join(current, segment);
  }
  try {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} data paths cannot contain symbolic links.`);
  } catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}
