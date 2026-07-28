import * as fs from 'fs/promises';
import * as path from 'path';
import { writeFileAtomically } from './atomicFile.js';
import { readUtf8FileBounded, readUtf8FilePrefix } from './boundedFs.js';
import {
  resolveRoomPath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from './workspace.js';
import {
  roomPathUsageBytes,
  type RoomUsageDelta,
  withRoomUsageTransaction
} from './roomUsageLedger.js';

const ROOM_STORAGE_QUOTA_BYTES = 256 * 1024 * 1024;
const ROOM_ARTIFACT_SECTION_ENTRY_LIMIT = 10_000;
const ROOM_ARTIFACT_SECTIONS = new Set([
  'documents',
  'reviews',
  'discussions',
  'tasks',
  'decisions'
]);

function roomStorageQuotaBytes(): number {
  if (process.env.NODE_ENV === 'test') {
    const configured = Number(process.env.ROOM_TEST_STORAGE_QUOTA_BYTES);
    if (Number.isSafeInteger(configured) && configured > 0) return configured;
  }
  return ROOM_STORAGE_QUOTA_BYTES;
}

export function roomArtifactSectionEntryLimit(): number {
  if (process.env.NODE_ENV === 'test') {
    const configured = Number(process.env.ROOM_TEST_ARTIFACT_ENTRY_LIMIT);
    if (Number.isSafeInteger(configured) && configured > 0) return configured;
  }
  return ROOM_ARTIFACT_SECTION_ENTRY_LIMIT;
}

export { roomPathUsageBytes };

export async function readRoomTextFile(
  workspace: WorkspaceInput,
  parts: string[],
  maxBytes = 4 * 1024 * 1024
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) {
    throw new Error('Invalid ROOM data read limit.');
  }
  return readUtf8FileBounded(resolveRoomPath(workspace, ...parts), maxBytes);
}

export async function readRoomTextFilePrefix(
  workspace: WorkspaceInput,
  parts: string[],
  maxBytes = 64 * 1024
): Promise<string> {
  return readUtf8FilePrefix(resolveRoomPath(workspace, ...parts), maxBytes);
}

export async function writeRoomTextFile(
  workspace: WorkspaceInput,
  parts: string[],
  content: string
): Promise<void> {
  const filePath = resolveRoomPath(workspace, ...parts);
  await ensureRoomParentDirectory(workspace, path.dirname(filePath));
  await withRoomStorageTransaction(workspace, async () => {
    const currentStat = await fs.lstat(filePath)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (!currentStat) await assertArtifactBatchCapacity(workspace, [parts]);
    return {
      bytes: Buffer.byteLength(content, 'utf-8')
        - (currentStat?.isFile() ? currentStat.size : 0),
      entries: currentStat ? 0 : 1
    };
  }, async () => {
    await writeFileAtomically(filePath, content);
  });
}

async function assertArtifactBatchCapacity(
  workspace: WorkspaceInput,
  newParts: readonly string[][]
): Promise<void> {
  const bySection = new Map<string, Set<string>>();
  for (const parts of newParts) {
    if (parts.length !== 2 || !ROOM_ARTIFACT_SECTIONS.has(parts[0])) continue;
    const names = bySection.get(parts[0]) || new Set<string>();
    names.add(parts[1]);
    bySection.set(parts[0], names);
  }
  for (const [section, names] of bySection) {
    const directoryPath = resolveRoomPath(workspace, section);
    const limit = roomArtifactSectionEntryLimit();
    if (names.size > limit) {
      throw new Error(`ROOM ${section} capacity of ${limit} entries has been reached.`);
    }
    let entries = 0;
    const directory = await fs.opendir(directoryPath);
    try {
      for await (const _entry of directory) {
        entries += 1;
        if (entries + names.size > limit) {
          throw new Error(
            `ROOM ${section} capacity of ${limit} entries has been reached.`
          );
        }
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
    if (entries + names.size > limit) {
      throw new Error(`ROOM ${section} capacity of ${limit} entries has been reached.`);
    }
  }
}

export async function appendRoomTextFile(
  workspace: WorkspaceInput,
  parts: string[],
  content: string
): Promise<void> {
  const filePath = resolveRoomPath(workspace, ...parts);
  await ensureRoomParentDirectory(workspace, path.dirname(filePath));
  await withRoomStorageTransaction(
    workspace,
    async () => {
      const exists = await fs.lstat(filePath).then(() => true).catch(error => {
        if (hasErrorCode(error, 'ENOENT')) return false;
        throw error;
      });
      return {
        bytes: Buffer.byteLength(content, 'utf-8'),
        entries: exists ? 0 : 1
      };
    },
    async () => {
      await fs.appendFile(filePath, content, { encoding: 'utf-8', mode: 0o600 });
    }
  );
}

export async function withRoomStorageTransaction<T>(
  workspace: WorkspaceInput,
  measureDeltaBytes: () => Promise<number | RoomUsageDelta | null>,
  operation: () => Promise<T>
): Promise<T> {
  const location = resolveWorkspaceLocation(workspace);
  return withRoomUsageTransaction(
    location.roomRoot,
    roomStorageQuotaBytes(),
    measureDeltaBytes,
    operation
  );
}

export async function withRoomStorageReconciliation<T>(
  workspace: WorkspaceInput,
  operation: () => Promise<T>
): Promise<T> {
  return withRoomStorageTransaction(workspace, async () => null, operation);
}

async function ensureRoomParentDirectory(
  workspace: WorkspaceInput,
  directoryPath: string
): Promise<void> {
  const exists = await fs.lstat(directoryPath).then(stat => stat.isDirectory()).catch(error => {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  });
  if (!exists) {
    await withRoomStorageReconciliation(
      workspace,
      () => fs.mkdir(directoryPath, { recursive: true, mode: 0o700 })
    );
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
