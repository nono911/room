import * as fs from 'fs/promises';
import * as path from 'path';
import { listDirectoryNamesBounded } from './boundedFs.js';
import {
  readRoomTextFile,
  withRoomStorageReconciliation,
  writeRoomTextFile
} from './roomFile.js';
import { withRoomDataLock } from './roomDataLock.js';
import type { RoomRecord } from './roomHome.js';
import type { RunRecord } from './runRecords.js';
import {
  isRunAttemptLeaseFresh,
  isRunAttemptLeaseOrphaned,
  removeRunAttemptLease
} from './runAttemptLease.js';
import { resolveRoomPath, type WorkspaceInput } from './workspace.js';

const RUN_RECORD_LIMIT = 10_000;
const RUN_RECORD_RETENTION = 2_000;
const RUN_RECORD_BYTES = 256 * 1024;
const RUN_ATTEMPT_LEASE_FILENAME =
  /^\.attempt-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.lease$/;

export interface RunRecoveryOptions {
  limit?: number;
  retention?: number;
}

export async function reconcileAbandonedRunRecords(
  record: RoomRecord,
  options: RunRecoveryOptions = {}
): Promise<void> {
  const limit = options.limit ?? RUN_RECORD_LIMIT;
  const retention = options.retention ?? RUN_RECORD_RETENTION;
  await withRoomDataLock(record.roomRoot, 'run-recovery', async () => {
    const workspace = { roomId: record.manifest.id, roomRoot: record.roomRoot };
    const runsDirectory = resolveRoomPath(workspace, 'runs');
    const listing = await listDirectoryNamesBounded(runsDirectory, limit)
      .catch((error: unknown) => {
        if (hasErrorCode(error, 'ENOENT')) return { names: [], truncated: false };
        throw error;
      });
    // A truncated listing is reconciled best-effort: refusing to proceed would
    // make a Room permanently unopenable once its history grew past the limit,
    // and pruning below is what brings it back under.
    const finished: Array<{ filename: string; startedAt: string }> = [];
    const liveLeaseFilenames = new Set<string>();
    for (const filename of listing.names) {
      if (!/^run_[a-f0-9]{32}\.json$/.test(filename)) continue;
      const run = JSON.parse(await readRoomTextFile(
        workspace,
        ['runs', filename],
        RUN_RECORD_BYTES
      )) as Partial<RunRecord>;
      if (run.status !== 'running') {
        finished.push({
          filename,
          startedAt: typeof run.startedAt === 'string' ? run.startedAt : ''
        });
        continue;
      }
      if (
        typeof run.attemptId === 'string'
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
          .test(run.attemptId)
        && typeof run.ownerPid === 'number'
        && Number.isSafeInteger(run.ownerPid)
        && run.ownerPid > 0
        && typeof run.ownerProcessIdentity === 'string'
        && await isRunAttemptLeaseFresh(
          workspace,
          run.attemptId,
          run.ownerPid,
          run.ownerProcessIdentity
        )
      ) {
        liveLeaseFilenames.add(`.attempt-${run.attemptId}.lease`);
        continue;
      }
      const recovered: RunRecord = {
        ...(run as RunRecord),
        status: 'interrupted',
        completedAt: new Date().toISOString(),
        error: 'Run interrupted before completion.'
      };
      await writeRoomTextFile(
        workspace,
        ['runs', filename],
        `${JSON.stringify(recovered, null, 2)}\n`
      );
      if (typeof run.attemptId === 'string') {
        await removeRunAttemptLease(workspace, run.attemptId);
      }
    }
    // A crash between lease creation and the run record write (or between the
    // terminal record write and lease release, both in runRecords.ts) leaves
    // a `.attempt-*.lease` file no run record claims. Nothing else on disk
    // reclaims these — roomSidecarCleanup's patterns don't match this name,
    // and the usage ledger excludes them from quota on purpose — so they leak
    // until reclaimed here, alongside the same listing already walked above.
    const orphanedLeases: string[] = [];
    for (const filename of listing.names) {
      if (!RUN_ATTEMPT_LEASE_FILENAME.test(filename) || liveLeaseFilenames.has(filename)) {
        continue;
      }
      if (await isRunAttemptLeaseOrphaned(path.join(runsDirectory, filename))) {
        orphanedLeases.push(filename);
      }
    }
    await pruneRunsDirectory(workspace, runsDirectory, finished, retention, orphanedLeases);
  });
}

/** Keeps `runs/` bounded so a Room cannot accumulate its way out of opening. */
async function pruneRunsDirectory(
  workspace: WorkspaceInput,
  runsDirectory: string,
  finished: Array<{ filename: string; startedAt: string }>,
  retention: number,
  orphanedLeaseFilenames: string[]
): Promise<void> {
  const expired = finished.length > retention
    ? finished
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .slice(0, finished.length - retention)
    : [];
  if (expired.length === 0 && orphanedLeaseFilenames.length === 0) return;
  // Reconciled rather than measured: the freed bytes are not tracked per file,
  // and an unaccounted delete would leave the usage ledger over-counting.
  await withRoomStorageReconciliation(workspace, async () => {
    for (const filename of [...expired.map(item => item.filename), ...orphanedLeaseFilenames]) {
      await fs.rm(path.join(runsDirectory, filename), { force: true });
    }
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
