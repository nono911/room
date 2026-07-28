import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  listDirectoryNamesBounded,
  readUtf8FileBounded
} from './boundedFs.js';
import {
  currentProcessIdentity,
  isFreshProcessLease,
  isProcessIdentity
} from './processLease.js';

const LOCK_WAIT_MS = 35_000;
const INVALID_LOCK_GRACE_MS = 30_000;

interface LockOwner {
  token: string;
  pid: number;
  processIdentity: string;
}

interface RecoveryClaim extends LockOwner {
  generation: number;
}

export async function withRoomDataLock<T>(
  roomRoot: string,
  lockName: string,
  run: () => Promise<T>
): Promise<T> {
  if (!/^[a-z0-9_-]{1,80}$/.test(lockName)) throw new Error('Invalid ROOM lock name.');
  const resolvedRoomRoot = path.resolve(roomRoot);
  await assertRoomDirectory(resolvedRoomRoot);
  const lockPath = path.join(resolvedRoomRoot, `.${lockName}.lock`);
  const ownerToken = randomUUID().replace(/-/g, '');
  const candidatePath = path.join(
    resolvedRoomRoot,
    `.${lockName}.lock-candidate-${ownerToken}`
  );
  const processIdentity = currentProcessIdentity();
  await fs.mkdir(candidatePath, { mode: 0o700 });
  try {
    await fs.writeFile(
      path.join(candidatePath, 'owner.json'),
      `${JSON.stringify({ token: ownerToken, pid: process.pid, processIdentity })}\n`,
      { encoding: 'utf-8', mode: 0o600, flag: 'wx' }
    );
  } catch (error) {
    await fs.rm(candidatePath, { recursive: true, force: true });
    throw error;
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  let acquired = false;
  try {
    while (true) {
      try {
        const now = new Date();
        await fs.utimes(path.join(candidatePath, 'owner.json'), now, now);
        await fs.rename(candidatePath, lockPath);
        acquired = true;
        break;
      } catch (error: unknown) {
        if (
          !hasErrorCode(error, 'EEXIST')
          && !hasErrorCode(error, 'ENOTEMPTY')
        ) throw error;
        const staleOwner = await readLockOwner(lockPath);
        if (
          staleOwner
          && !await isFreshProcessLease(
            path.join(lockPath, 'owner.json'),
            staleOwner.pid,
            staleOwner.processIdentity
          )
        ) {
          const quarantined = await quarantineLock(
            resolvedRoomRoot,
            lockName,
            lockPath,
            staleOwner.token
          );
          if (quarantined) continue;
        }
        if (!staleOwner) {
          const stat = await fs.lstat(lockPath).catch(() => null);
          if (stat && Date.now() - stat.mtimeMs > INVALID_LOCK_GRACE_MS) {
            throw new Error(`ROOM ${lockName} lock ownership is invalid.`);
          }
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for ROOM ${lockName} lock.`);
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    return await run();
  } finally {
    if (!acquired) {
      await fs.rm(candidatePath, { recursive: true, force: true });
    } else {
      const currentOwner = await readLockOwner(lockPath);
      if (currentOwner?.token === ownerToken) {
        const releasePath = path.join(
          resolvedRoomRoot,
          `.${lockName}.lock-release-${ownerToken}`
        );
        await fs.rename(lockPath, releasePath);
        await fs.rm(releasePath, { recursive: true });
      }
    }
  }
}

async function quarantineLock(
  roomRoot: string,
  lockName: string,
  lockPath: string,
  ownerToken: string
): Promise<boolean> {
  const claim = await acquireRecoveryClaim(lockPath, ownerToken);
  if (!claim) return false;
  const claimedOwner = await readLockOwner(lockPath);
  if (claimedOwner?.token !== ownerToken) {
    await fs.rm(recoveryClaimPath(lockPath, ownerToken, claim.generation), {
      force: true
    });
    return false;
  }
  const safeToken = ownerToken.replace(/[^a-zA-Z0-9_-]/g, '-');
  const tombstone = path.join(
    roomRoot,
    `.${lockName}.lock-owner-${safeToken}`
  );
  try {
    await fs.rename(lockPath, tombstone);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function acquireRecoveryClaim(
  lockPath: string,
  ownerToken: string
): Promise<RecoveryClaim | null> {
  const listing = await listDirectoryNamesBounded(lockPath, 256).catch(
    (error: unknown) => {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
  );
  if (!listing) return null;
  if (listing.truncated) throw new Error('ROOM lock recovery claims exceed their limit.');
  const prefix = `.recovery-${ownerToken}-`;
  const generations = listing.names.flatMap(name => {
    if (!name.startsWith(prefix)) return [];
    const raw = name.slice(prefix.length);
    return /^\d{1,3}$/.test(raw) ? [Number(raw)] : [];
  });
  const generation = generations.length === 0 ? 0 : Math.max(...generations);
  if (generation >= 127) throw new Error('ROOM lock recovery generation limit exceeded.');
  if (generations.length > 0) {
    const active = await readRecoveryClaim(
      recoveryClaimPath(lockPath, ownerToken, generation),
      generation
    );
    if (
      active
      && await isFreshProcessLease(
        recoveryClaimPath(lockPath, ownerToken, generation),
        active.pid,
        active.processIdentity
      )
    ) return null;
  }
  const nextGeneration = generations.length === 0 ? 0 : generation + 1;
  const claim: RecoveryClaim = {
    token: randomUUID().replace(/-/g, ''),
    pid: process.pid,
    processIdentity: currentProcessIdentity(),
    generation: nextGeneration
  };
  const destination = recoveryClaimPath(lockPath, ownerToken, nextGeneration);
  const temporary = path.join(lockPath, `.recovery-candidate-${claim.token}`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(claim)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx'
    });
    await fs.link(temporary, destination);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'EEXIST') || hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return claim;
}

async function readRecoveryClaim(
  claimPath: string,
  generation: number
): Promise<RecoveryClaim | null> {
  try {
    const value = JSON.parse(await readUtf8FileBounded(claimPath, 4 * 1024)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const claim = value as Record<string, unknown>;
    return typeof claim.token === 'string'
      && /^[a-f0-9]{32}$/.test(claim.token)
      && typeof claim.pid === 'number'
      && Number.isSafeInteger(claim.pid)
      && claim.pid > 0
      && isProcessIdentity(claim.processIdentity)
      && claim.generation === generation
      ? claim as unknown as RecoveryClaim
      : null;
  } catch {
    return null;
  }
}

function recoveryClaimPath(
  lockPath: string,
  ownerToken: string,
  generation: number
): string {
  return path.join(lockPath, `.recovery-${ownerToken}-${generation}`);
}

async function assertRoomDirectory(directoryPath: string): Promise<void> {
  const stat = await fs.lstat(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`ROOM managed path must be a real directory: ${directoryPath}`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`ROOM managed path must be owned by the current user: ${directoryPath}`);
  }
}

async function readLockOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const value = JSON.parse(await readUtf8FileBounded(
      path.join(lockPath, 'owner.json'),
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
      ? {
          token: owner.token,
          pid: owner.pid,
          processIdentity: owner.processIdentity
        }
      : null;
  } catch {
    return null;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
