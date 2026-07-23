import * as path from 'path';

export interface WorkspaceLocation {
  sourceRoot: string;
  roomRoot: string;
}

export type WorkspaceInput = string | WorkspaceLocation;

export function resolveWorkspaceLocation(input: WorkspaceInput): WorkspaceLocation {
  if (typeof input === 'string') {
    const sourceRoot = path.resolve(input);
    return {
      sourceRoot,
      roomRoot: path.join(sourceRoot, '.room')
    };
  }

  return {
    sourceRoot: path.resolve(input.sourceRoot),
    roomRoot: path.resolve(input.roomRoot)
  };
}

export function resolveRoomPath(input: WorkspaceInput, ...parts: string[]): string {
  return path.join(resolveWorkspaceLocation(input).roomRoot, ...parts);
}

export function resolveSourcePath(input: WorkspaceInput, ...parts: string[]): string {
  return path.join(resolveWorkspaceLocation(input).sourceRoot, ...parts);
}
