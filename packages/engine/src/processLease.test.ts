import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  currentProcessIdentity,
  isFreshProcessLease
} from './processLease.js';

describe('process incarnation leases', () => {
  it('does not expire a live matching process because its mtime is old', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-process-lease-'));
    const leasePath = path.join(root, 'owner.json');
    try {
      await fs.writeFile(leasePath, '{}');
      const stale = new Date(Date.now() - 60_000);
      await fs.utimes(leasePath, stale, stale);

      await expect(isFreshProcessLease(
        leasePath,
        process.pid,
        currentProcessIdentity()
      )).resolves.toBe(true);
      await expect(isFreshProcessLease(
        leasePath,
        process.pid,
        'different-process-incarnation'
      )).resolves.toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a live unverifiable lease non-reclaimable after identity lookup recovers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-process-fallback-'));
    const leasePath = path.join(root, 'owner.json');
    try {
      await fs.writeFile(leasePath, '{}');
      await expect(isFreshProcessLease(
        leasePath,
        process.pid,
        `unverified:${process.pid}:0`
      )).resolves.toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
