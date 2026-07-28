import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { withRoomDataLock } from './roomHome.js';
import {
  resolveSourceStatePath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from './workspace.js';
import { roomPathUsageBytes } from './roomFile.js';
import { readUtf8FileBounded } from './boundedFs.js';

const GENERATION_PATTERN = /^generation-[a-f0-9]{32}$/;
export const SCAN_GENERATION_RETENTION = 5;
export const SCAN_ORPHAN_GRACE_MS = 15 * 60 * 1000;

interface ScanPointer {
  generation: string;
}

export function createScanGenerationId(): string {
  return `generation-${randomUUID().replace(/-/g, '')}`;
}

export async function publishScanGeneration(
  workspace: WorkspaceInput,
  generation: string
): Promise<void> {
  if (!GENERATION_PATTERN.test(generation)) throw new Error('Invalid scan generation.');
  const scanRoot = resolveSourceStatePath(workspace, 'scan');
  const generationRoot = resolveSourceStatePath(
    workspace,
    'scan',
    'generations',
    generation
  );
  await fs.writeFile(path.join(generationRoot, '.published'), '', {
    encoding: 'utf-8',
    mode: 0o600,
    flag: 'wx'
  });
  const temporaryPath = path.join(scanRoot, `.current-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ generation } satisfies ScanPointer)}\n`,
      { encoding: 'utf-8', mode: 0o600, flag: 'wx' }
    );
    await fs.rename(temporaryPath, path.join(scanRoot, 'current.json'));
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function resolveCurrentScanSnapshot(
  workspace: WorkspaceInput
): Promise<string | undefined> {
  const pointerPath = resolveSourceStatePath(workspace, 'scan', 'current.json');
  let raw: string;
  try {
    const stat = await fs.lstat(pointerPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Scan snapshot pointer must be a real file.');
    }
    raw = await readUtf8FileBounded(pointerPath, 4 * 1024);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  }

  const value = JSON.parse(raw) as unknown;
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !GENERATION_PATTERN.test((value as Record<string, unknown>).generation as string)
  ) {
    throw new Error('Invalid scan snapshot pointer.');
  }
  const generation = (value as ScanPointer).generation;
  const generationRoot = resolveSourceStatePath(workspace, 'scan', 'generations', generation);
  const stat = await fs.lstat(generationRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Scan snapshot must be a real directory.');
  }
  return generationRoot;
}

export async function withCurrentScanSnapshot<T>(
  workspace: WorkspaceInput,
  read: (snapshotRoot: string, generation: string) => Promise<T>
): Promise<T | undefined> {
  const resolved = resolveWorkspaceLocation(workspace);
  if (!resolved.sourceId) return undefined;
  return withRoomDataLock(
    resolved.roomRoot,
    `scan-${resolved.sourceId}`,
    async () => {
      const snapshotRoot = await resolveCurrentScanSnapshot(resolved);
      return snapshotRoot
        ? read(snapshotRoot, path.basename(snapshotRoot))
        : undefined;
    }
  );
}

export async function pruneScanGenerations(
  workspace: WorkspaceInput,
  currentGeneration: string,
  retention = SCAN_GENERATION_RETENTION
): Promise<void> {
  if (!GENERATION_PATTERN.test(currentGeneration)) throw new Error('Invalid scan generation.');
  if (!Number.isSafeInteger(retention) || retention < 2) {
    throw new Error('Scan generation retention must preserve at least two snapshots.');
  }
  const candidates = await loadGenerationCandidates(workspace);
  const removable = selectRemovableGenerations(candidates, currentGeneration, retention);
  for (const candidate of removable) {
    const current = await fs.lstat(candidate.path).catch(() => null);
    if (!current || current.isSymbolicLink() || !current.isDirectory()) continue;
    await fs.rm(candidate.path, { recursive: true, force: false });
  }
}

export async function measureScanReplacementCredit(
  workspace: WorkspaceInput,
  nextGeneration: string,
  retention = SCAN_GENERATION_RETENTION
): Promise<number> {
  if (!GENERATION_PATTERN.test(nextGeneration)) throw new Error('Invalid scan generation.');
  const pointerPath = resolveSourceStatePath(workspace, 'scan', 'current.json');
  const pointerBytes = await fs.lstat(pointerPath)
    .then(stat => stat.isFile() && !stat.isSymbolicLink() ? stat.size : 0)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return 0;
      throw error;
    });
  const removable = selectRemovableGenerations(
    await loadGenerationCandidates(workspace),
    nextGeneration,
    retention
  );
  const generationBytes = await Promise.all(
    removable.map(candidate => roomPathUsageBytes(candidate.path))
  );
  return pointerBytes + generationBytes.reduce((total, bytes) => total + bytes, 0);
}

interface GenerationCandidate {
  name: string;
  path: string;
  modifiedAt: number;
  published: boolean;
}

async function loadGenerationCandidates(
  workspace: WorkspaceInput
): Promise<GenerationCandidate[]> {
  const generationsRoot = resolveSourceStatePath(workspace, 'scan', 'generations');
  let directory: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directory = await fs.opendir(generationsRoot);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }
  const candidates: GenerationCandidate[] = [];
  let inspectedEntries = 0;
  try {
    for await (const entry of directory) {
      inspectedEntries += 1;
      if (inspectedEntries > 2_000) {
        throw new Error('Scan generation directory exceeds its entry limit.');
      }
      if (
        candidates.length >= 1_000
        || !GENERATION_PATTERN.test(entry.name)
        || !entry.isDirectory()
        || entry.isSymbolicLink()
      ) continue;
      const generationPath = path.join(generationsRoot, entry.name);
      const [stat, marker] = await Promise.all([
        fs.lstat(generationPath),
        fs.lstat(path.join(generationPath, '.published')).catch(() => null)
      ]);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      candidates.push({
        name: entry.name,
        path: generationPath,
        modifiedAt: stat.mtimeMs,
        published: Boolean(marker && !marker.isSymbolicLink() && marker.isFile())
      });
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return candidates;
}

function selectRemovableGenerations(
  candidates: GenerationCandidate[],
  currentGeneration: string,
  retention: number
): GenerationCandidate[] {
  const keep = new Set([
    currentGeneration,
    ...candidates
      .filter(candidate => candidate.published && candidate.name !== currentGeneration)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, retention - 1)
      .map(candidate => candidate.name)
  ]);
  return candidates.filter(candidate => (
    candidate.published
      ? !keep.has(candidate.name)
      : Date.now() - candidate.modifiedAt >= SCAN_ORPHAN_GRACE_MS
  ));
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
