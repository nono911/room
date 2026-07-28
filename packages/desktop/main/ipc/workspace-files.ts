import type { RoomSource } from '@room/engine';
import {
  browsePinnedSource,
  listPinnedSourceFiles
} from './pinned-source.js';
import { sanitizeWorkspaceRelativePath } from './shared.js';

export interface WorkspaceFileItem {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: 'file' | 'directory';
  extension?: string;
  childCount?: number;
  childCountTruncated?: boolean;
}

export async function listWorkspaceFiles(
  source: RoomSource
): Promise<{ files: WorkspaceFileItem[]; truncated: boolean }> {
  return listPinnedSourceFiles(source);
}

export async function browseWorkspaceFiles(
  source: RoomSource,
  relativeDirectory = '',
  query = ''
): Promise<{ files: WorkspaceFileItem[]; truncated: boolean }> {
  const safeDirectory = relativeDirectory
    ? sanitizeWorkspaceRelativePath(relativeDirectory)
    : '';
  return browsePinnedSource(source, safeDirectory, query);
}
