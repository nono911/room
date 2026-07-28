import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { withRoomDataLock } from './roomDataLock.js';
import {
  resolveWorkspaceLocation,
  type WorkspaceInput
} from './workspace.js';
import {
  listDirectoryNamesBounded,
  readUtf8FileBounded
} from './boundedFs.js';
import {
  currentProcessIdentity,
  isFreshProcessLease,
  isProcessIdentity
} from './processLease.js';

const MAX_GLOBAL_AI_RUNS = 4;
const MAX_ROOM_AI_RUNS = 2;
const LEASE_PATTERN = /^\.ai-run-([a-f0-9]{32})\.lease$/;
const INVALID_LEASE_GRACE_MS = 30_000;

interface AiRunLeaseOwner {
  token: string;
  pid: number;
  processIdentity: string;
  roomId: string;
  operationId: string;
}

export async function withAiRunAdmission<T>(
  workspace: WorkspaceInput,
  operationId: string,
  run: () => Promise<T>
): Promise<T> {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(operationId)) {
    throw new Error('Invalid AI operation id.');
  }
  const location = resolveWorkspaceLocation(workspace);
  const admissionRoot = await ensureAdmissionRoot(location.roomRoot);
  const token = randomUUID().replace(/-/g, '');
  const processIdentity = currentProcessIdentity();
  const leasePath = path.join(admissionRoot, `.ai-run-${token}.lease`);
  const ownerPath = path.join(leasePath, 'owner.json');
  await withRoomDataLock(admissionRoot, 'ai-admission', async () => {
    const active = await loadActiveLeases(admissionRoot);
    if (active.some(lease => (
      lease.roomId === location.roomId && lease.operationId === operationId
    ))) {
      throw new Error('That AI operation is already active.');
    }
    if (
      active.length >= MAX_GLOBAL_AI_RUNS
      || active.filter(lease => lease.roomId === location.roomId).length >= MAX_ROOM_AI_RUNS
    ) {
      throw new Error('ROOM is at its active AI run limit. Wait for a run to finish.');
    }
    await fs.mkdir(leasePath, { mode: 0o700 });
    try {
      await fs.writeFile(
        ownerPath,
        `${JSON.stringify({
          token,
          pid: process.pid,
          processIdentity,
          roomId: location.roomId,
          operationId
        })}\n`,
        { encoding: 'utf-8', mode: 0o600, flag: 'wx' }
      );
    } catch (error) {
      await fs.rm(leasePath, { recursive: true, force: true });
      throw error;
    }
  });
  try {
    return await run();
  } finally {
    await withRoomDataLock(admissionRoot, 'ai-admission', async () => {
      const owner = await readLeaseOwner(leasePath);
      if (owner?.token === token) {
        await fs.rm(leasePath, { recursive: true });
      }
    });
  }
}

async function ensureAdmissionRoot(roomRoot: string): Promise<string> {
  const resolvedRoom = path.resolve(roomRoot);
  const roomsRoot = path.dirname(resolvedRoom);
  const roomHome = path.basename(roomsRoot) === 'rooms'
    ? path.dirname(roomsRoot)
    : resolvedRoom;
  const admissionRoot = path.join(roomHome, 'system');
  await fs.mkdir(admissionRoot, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(admissionRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('ROOM AI admission root must be a real directory.');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('ROOM AI admission root must be owned by the current user.');
  }
  return admissionRoot;
}

async function loadActiveLeases(admissionRoot: string): Promise<AiRunLeaseOwner[]> {
  const active: AiRunLeaseOwner[] = [];
  const listing = await listDirectoryNamesBounded(admissionRoot, 512);
  if (listing.truncated) throw new Error('ROOM AI admission directory exceeds its entry limit.');
  for (const entry of listing.names) {
    if (!LEASE_PATTERN.test(entry)) continue;
    const leasePath = path.join(admissionRoot, entry);
    const entryStat = await fs.lstat(leasePath).catch(() => null);
    if (!entryStat || entryStat.isSymbolicLink() || !entryStat.isDirectory()) continue;
    const owner = await readLeaseOwner(leasePath);
    if (
      owner
      && await isFreshProcessLease(
        path.join(leasePath, 'owner.json'),
        owner.pid,
        owner.processIdentity
      )
    ) {
      active.push(owner);
      continue;
    }
    const stat = await fs.lstat(leasePath).catch(() => null);
    if (owner || (stat && Date.now() - stat.mtimeMs > INVALID_LEASE_GRACE_MS)) {
      await fs.rm(leasePath, { recursive: true, force: true });
    }
  }
  return active;
}

async function readLeaseOwner(leasePath: string): Promise<AiRunLeaseOwner | null> {
  try {
    const value = JSON.parse(await readUtf8FileBounded(
      path.join(leasePath, 'owner.json'),
      4 * 1024
    )) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const owner = value as Record<string, unknown>;
    return typeof owner.token === 'string'
      && /^[a-f0-9]{32}$/.test(owner.token)
      && typeof owner.pid === 'number'
      && Number.isSafeInteger(owner.pid)
      && owner.pid > 0
      && isProcessIdentity(owner.processIdentity)
      && typeof owner.roomId === 'string'
      && /^room_[a-z0-9_-]{1,64}$/.test(owner.roomId)
      && typeof owner.operationId === 'string'
      && /^[a-zA-Z0-9:_-]{1,160}$/.test(owner.operationId)
      ? owner as unknown as AiRunLeaseOwner
      : null;
  } catch {
    return null;
  }
}
