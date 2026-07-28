import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';

const PROCESS_IDENTITY_LIMIT = 160;
let cachedCurrentProcessIdentity: string | undefined;

export function currentProcessIdentity(): string {
  if (cachedCurrentProcessIdentity) return cachedCurrentProcessIdentity;
  const identity = readProcessIdentity(process.pid);
  cachedCurrentProcessIdentity = identity || `unverified:${process.pid}:${Math.floor(
    Date.now() - process.uptime() * 1_000
  )}`;
  return cachedCurrentProcessIdentity;
}

export async function isFreshProcessLease(
  leasePath: string,
  pid: number,
  processIdentity: string
): Promise<boolean> {
  const stat = await fs.lstat(leasePath).catch((error: unknown) => {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  });
  return Boolean(
    stat
    && stat.isFile()
    && !stat.isSymbolicLink()
    && isSameProcessIncarnation(pid, processIdentity)
  );
}

export function isProcessIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf-8') <= PROCESS_IDENTITY_LIMIT
    && !/[\r\n\0]/.test(value);
}

function isSameProcessIncarnation(
  pid: number,
  expectedIdentity: string
): boolean {
  if (!isProcessAlive(pid)) return false;
  if (isUnverifiedIdentityForPid(expectedIdentity, pid)) return true;
  const actualIdentity = readProcessIdentity(pid);
  return actualIdentity === null || actualIdentity === expectedIdentity;
}

function isUnverifiedIdentityForPid(identity: string, pid: number): boolean {
  const match = /^unverified:(\d+):\d+$/.exec(identity);
  return Boolean(match && Number(match[1]) === pid);
}

function readProcessIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1 || !isProcessAlive(pid)) return null;
  try {
    const identity = execFileSync(
      '/bin/ps',
      ['-p', String(pid), '-o', 'lstart='],
      {
        encoding: 'utf-8',
        timeout: 1_000,
        maxBuffer: 4 * 1024,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim();
    return isProcessIdentity(identity) ? identity : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return hasErrorCode(error, 'EPERM');
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
