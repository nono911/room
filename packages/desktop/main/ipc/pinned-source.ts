import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import type { RoomSource, ScanResult } from '@room/engine';
import { createSanitizedChildEnvironment, scanDirectory } from '@room/engine';
import {
  IGNORED_WORKSPACE_DIRS,
  WORKSPACE_FILE_LIMIT
} from './shared.js';
import type { WorkspaceFileItem } from './workspace-files.js';
import { withSourceOperationQueue } from './source-operation-queue.js';
import { SOURCE_WORKER_SCRIPT } from './pinned-source-worker.js';

const execFileAsync = promisify(execFile);
const SOURCE_OPERATION_TIMEOUT_MS = 20_000;
const SOURCE_OPERATION_BUFFER_BYTES = 8 * 1024 * 1024;
const SOURCE_SERIALIZED_OUTPUT_BYTES = 6 * 1024 * 1024;
const SOURCE_INSPECTION_LIMIT = 10_000;
const SOURCE_DIRECTORY_LIMIT = 4096;

export interface PinnedEntry {
  name: string;
  path?: string;
  kind: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  childCount?: number;
  childCountTruncated?: boolean;
  previewBase64?: string;
}

export interface PinnedWalkResult {
  entries: PinnedEntry[];
  truncated: boolean;
}

interface PinnedReadResult {
  data: string;
  size: number;
  modifiedAt: string;
}

export interface SourceGitStatus {
  repository: boolean;
  branch?: string;
  commit?: string;
  unsupportedReason?: string;
}

async function runPinnedOperation<T>(
  source: RoomSource,
  request: Record<string, unknown>
): Promise<T> {
  return withSourceOperationQueue(source, async () => {
    const payload = JSON.stringify({
      ...request,
      expectedDevice: source.rootDevice,
      expectedInode: source.rootInode,
      expectedBirthtimeNs: source.rootBirthtimeNs
    });
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', SOURCE_WORKER_SCRIPT, '--', payload],
      {
        cwd: source.canonicalPath,
        env: {
          ...createSanitizedChildEnvironment(),
          ELECTRON_RUN_AS_NODE: '1'
        },
        timeout: SOURCE_OPERATION_TIMEOUT_MS,
        maxBuffer: SOURCE_OPERATION_BUFFER_BYTES,
        windowsHide: true
      }
    );
    return JSON.parse(stdout) as T;
  });
}

export async function walkPinnedSource(
  source: RoomSource,
  relativeDirectory: string,
  maxEntries: number,
  maxDepth: number,
  options: {
    includeChildCount?: boolean;
    includePreviews?: boolean;
    previewBytes?: number;
    previewBudgetBytes?: number;
    maxPreviewFileBytes?: number;
  } = {}
): Promise<PinnedWalkResult> {
  return runPinnedOperation<PinnedWalkResult>(source, {
    operation: 'walk',
    relativePath: relativeDirectory,
    maxEntries,
    maxDepth,
    maxInspectedEntries: SOURCE_INSPECTION_LIMIT,
    maxDirectoryEntries: SOURCE_DIRECTORY_LIMIT,
    maxDurationMs: 15_000,
    maxSerializedBytes: SOURCE_SERIALIZED_OUTPUT_BYTES,
    ...options,
    ignoredDirectories: [...IGNORED_WORKSPACE_DIRS]
  });
}

export async function readPinnedSourceFile(
  source: RoomSource,
  relativePath: string,
  maxBytes: number
): Promise<{ buffer: Buffer; size: number; modifiedAt: string }> {
  const result = await runPinnedOperation<PinnedReadResult>(source, {
    operation: 'read',
    relativePath,
    maxBytes
  });
  return {
    buffer: Buffer.from(result.data, 'base64'),
    size: result.size,
    modifiedAt: result.modifiedAt
  };
}

export async function browsePinnedSource(
  source: RoomSource,
  relativeDirectory = '',
  query = ''
): Promise<{ files: WorkspaceFileItem[]; truncated: boolean }> {
  const normalizedQuery = query.trim().toLowerCase();
  const limit = normalizedQuery ? WORKSPACE_FILE_LIMIT : 250;
  const walked = await walkPinnedSource(
    source,
    relativeDirectory,
    normalizedQuery ? 2500 : limit + 1,
    normalizedQuery ? 32 : 0,
    { includeChildCount: !normalizedQuery }
  );
  const matches = walked.entries.filter(entry => (
    !normalizedQuery || entry.path!.toLowerCase().includes(normalizedQuery)
  ));
  const files = matches.slice(0, limit).map(entry => ({
    path: entry.path!,
    name: entry.name,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
    kind: entry.kind,
    childCount: entry.childCount,
    childCountTruncated: entry.childCountTruncated,
    extension: entry.kind === 'file'
      ? path.extname(entry.name).slice(1).toLowerCase() || undefined
      : undefined
  }));
  return {
    files,
    truncated: walked.truncated || matches.length > limit
  };
}

export async function listPinnedSourceFiles(
  source: RoomSource,
  entryLimit = WORKSPACE_FILE_LIMIT
): Promise<{ files: WorkspaceFileItem[]; truncated: boolean }> {
  const walked = await walkPinnedSource(source, '', entryLimit, 32);
  const files = walked.entries.map(entry => ({
    path: entry.path!,
    name: entry.name,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
    kind: entry.kind,
    extension: entry.kind === 'file'
      ? path.extname(entry.name).slice(1).toLowerCase() || undefined
      : undefined
  }));
  // The worker also truncates on its 15s deadline, 10,000-dirent inspection
  // budget, and 6MB serialization cap — all reachable below the entry cap, so
  // `walked.truncated` must be honored rather than re-derived from the count
  // (which would also misreport a directory with exactly `entryLimit` files).
  return { files, truncated: walked.truncated };
}

export async function getPinnedGitStatus(source: RoomSource): Promise<SourceGitStatus> {
  return runPinnedOperation<SourceGitStatus>(source, { operation: 'git' });
}

export async function scanPinnedSource(source: RoomSource): Promise<ScanResult> {
  return withSourceOperationQueue(source, () => scanDirectory(source.canonicalPath, {
    device: source.rootDevice,
    inode: source.rootInode,
    birthtimeNs: source.rootBirthtimeNs
  }));
}
