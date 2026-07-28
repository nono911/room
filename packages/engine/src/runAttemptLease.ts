import * as fs from 'fs/promises';
import * as path from 'path';
import { readUtf8FileBounded } from './boundedFs.js';
import {
  currentProcessIdentity,
  isFreshProcessLease,
  isProcessIdentity
} from './processLease.js';
import {
  resolveRoomPath,
  type WorkspaceInput
} from './workspace.js';

interface RunAttemptLease {
  attemptId: string;
  pid: number;
  processIdentity: string;
}

const ATTEMPT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export async function createRunAttemptLease(
  workspace: WorkspaceInput,
  attemptId: string
): Promise<() => Promise<void>> {
  const leasePath = resolveRunAttemptLeasePath(workspace, attemptId);
  await fs.mkdir(path.dirname(leasePath), { recursive: true, mode: 0o700 });
  const processIdentity = currentProcessIdentity();
  await fs.writeFile(
    leasePath,
    `${JSON.stringify({ attemptId, pid: process.pid, processIdentity })}\n`,
    { encoding: 'utf-8', mode: 0o600, flag: 'wx' }
  );
  return async () => {
    const lease = await readRunAttemptLease(leasePath);
    if (
      lease?.attemptId === attemptId
      && lease.pid === process.pid
      && lease.processIdentity === processIdentity
    ) {
      await fs.unlink(leasePath).catch((error: unknown) => {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      });
    }
  };
}

export async function isRunAttemptLeaseFresh(
  workspace: WorkspaceInput,
  attemptId: string,
  ownerPid: number,
  ownerProcessIdentity: string
): Promise<boolean> {
  if (!ATTEMPT_ID.test(attemptId)) return false;
  const leasePath = resolveRunAttemptLeasePath(workspace, attemptId);
  const lease = await readRunAttemptLease(leasePath);
  return Boolean(
    lease
    && lease.attemptId === attemptId
    && lease.pid === ownerPid
    && lease.processIdentity === ownerProcessIdentity
    && await isFreshProcessLease(leasePath, ownerPid, ownerProcessIdentity)
  );
}

export async function removeRunAttemptLease(
  workspace: WorkspaceInput,
  attemptId: string
): Promise<void> {
  if (!ATTEMPT_ID.test(attemptId)) return;
  await fs.unlink(resolveRunAttemptLeasePath(workspace, attemptId))
    .catch((error: unknown) => {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    });
}

/**
 * A lease with no run record claiming it (crash between lease creation and
 * the record write, or between the terminal record write and release) is
 * only safe to reclaim once it is provably not still held: unreadable, or
 * readable but no longer a fresh process lease.
 */
export async function isRunAttemptLeaseOrphaned(leasePath: string): Promise<boolean> {
  const lease = await readRunAttemptLease(leasePath);
  return !(lease && await isFreshProcessLease(leasePath, lease.pid, lease.processIdentity));
}

export function resolveRunAttemptLeasePath(
  workspace: WorkspaceInput,
  attemptId: string
): string {
  if (!ATTEMPT_ID.test(attemptId)) throw new Error('Invalid run attempt ID.');
  return resolveRoomPath(workspace, 'runs', `.attempt-${attemptId}.lease`);
}

async function readRunAttemptLease(
  leasePath: string
): Promise<RunAttemptLease | null> {
  try {
    const value = JSON.parse(await readUtf8FileBounded(leasePath, 4 * 1024)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const lease = value as Record<string, unknown>;
    return typeof lease.attemptId === 'string'
      && ATTEMPT_ID.test(lease.attemptId)
      && typeof lease.pid === 'number'
      && Number.isSafeInteger(lease.pid)
      && lease.pid > 0
      && isProcessIdentity(lease.processIdentity)
      ? lease as unknown as RunAttemptLease
      : null;
  } catch {
    return null;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
