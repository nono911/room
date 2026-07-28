import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { createExecutionProvenance, type SourceProvenance } from './discussion/types.js';
import {
  resolveRoomPath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from './workspace.js';
import { withRoomDataLock } from './roomDataLock.js';
import { readRoomTextFile, writeRoomTextFile } from './roomFile.js';
import { createRunAttemptLease } from './runAttemptLease.js';
import { currentProcessIdentity } from './processLease.js';
import type { ExecutionParticipantSnapshot } from './discussion/executionParticipants.js';

export type RunKind = 'discussion' | 'task' | 'summary' | 'moderation' | 'task-generation' | 'scan' | 'impact';

export interface RunRecord {
  id: string;
  kind: RunKind;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  attemptId: string;
  ownerPid: number;
  ownerProcessIdentity: string;
  subjectId?: string;
  participants?: ExecutionParticipantSnapshot[];
  sourceProvenance: SourceProvenance;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

function subjectLockNamespace(kind: RunKind): 'discussion' | 'task' | null {
  if (kind === 'discussion' || kind === 'summary' || kind === 'moderation' || kind === 'task-generation') {
    return 'discussion';
  }
  return kind === 'task' ? 'task' : null;
}

async function writeRunRecord(workspace: WorkspaceInput, record: RunRecord): Promise<void> {
  await writeRoomTextFile(
    workspace,
    ['runs', `${record.id}.json`],
    `${JSON.stringify(record, null, 2)}\n`
  );
}

export async function executeRecordedRun<T>(
  workspace: WorkspaceInput,
  kind: RunKind,
  subjectId: string | undefined,
  execute: (provenance: SourceProvenance) => Promise<T>,
  concurrencySubjectId = subjectId,
  participants: readonly ExecutionParticipantSnapshot[] = []
): Promise<T> {
  const resolvedWorkspace = resolveWorkspaceLocation(workspace);
  const executeWithRecord = async (): Promise<T> => {
    const provenance = createExecutionProvenance(resolvedWorkspace);
    const attemptId = randomUUID();
    const record: RunRecord = {
      id: `run_${randomUUID().replace(/-/g, '')}`,
      attemptId,
      ownerPid: process.pid,
      ownerProcessIdentity: currentProcessIdentity(),
      kind,
      status: 'running',
      ...(subjectId ? { subjectId } : {}),
      ...(participants.length > 0 ? { participants: [...participants] } : {}),
      sourceProvenance: provenance,
      startedAt: provenance.startedAt
    };
    const releaseAttemptLease = await createRunAttemptLease(
      resolvedWorkspace,
      attemptId
    );
    try {
      await writeRunRecord(resolvedWorkspace, record);
      try {
        const result = await execute(provenance);
        await writeRunRecord(resolvedWorkspace, {
          ...record,
          status: 'completed',
          completedAt: new Date().toISOString()
        });
        return result;
      } catch (error: unknown) {
        await writeRunRecord(resolvedWorkspace, {
          ...record,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: 'Run failed.'
        });
        throw error;
      }
    } finally {
      await releaseAttemptLease();
    }
  };
  const lockNamespace = subjectLockNamespace(kind);
  if (concurrencySubjectId && lockNamespace) {
    const subjectHash = createHash('sha256')
      .update(concurrencySubjectId)
      .digest('hex')
      .slice(0, 24);
    return withRoomDataLock(
      resolvedWorkspace.roomRoot,
      `run-${lockNamespace}-${subjectHash}`,
      executeWithRecord
    );
  }
  return executeWithRecord();
}

export async function readRunRecord(workspace: WorkspaceInput, runId: string): Promise<RunRecord> {
  if (!/^run_[a-f0-9]{32}$/.test(runId)) throw new Error('Invalid run ID.');
  return JSON.parse(await readRoomTextFile(
    workspace,
    ['runs', `${runId}.json`]
  )) as RunRecord;
}
