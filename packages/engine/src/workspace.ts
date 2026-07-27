import * as path from 'path';

export interface WorkspaceLocation {
  sourceRoot?: string;
  sourceId?: string;
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
    sourceRoot: input.sourceRoot ? path.resolve(input.sourceRoot) : undefined,
    sourceId: input.sourceId,
    roomRoot: path.resolve(input.roomRoot)
  };
}

export function resolveRoomPath(input: WorkspaceInput, ...parts: string[]): string {
  return path.join(resolveWorkspaceLocation(input).roomRoot, ...parts);
}

export function resolveSourcePath(input: WorkspaceInput, ...parts: string[]): string {
  const sourceRoot = resolveWorkspaceLocation(input).sourceRoot;
  if (!sourceRoot) throw new Error('Attach a Source before accessing source files.');
  return path.join(sourceRoot, ...parts);
}

export function resolveExecutionRoot(input: WorkspaceInput): string {
  const workspace = resolveWorkspaceLocation(input);
  return workspace.sourceRoot || workspace.roomRoot;
}
