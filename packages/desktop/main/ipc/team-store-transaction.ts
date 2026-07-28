import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  withRoomDataLock,
  withRoomMemberMutation,
  withRoomStorageTransaction
} from '@room/engine';
import {
  requireBoundRoomWorkspace,
  resolveWithinRoomData
} from './shared.js';
import { assertNoPendingMemberDeletions } from './member-tombstone.js';
import { withTeamMutation } from './team-store-limits.js';

export class TeamStoreTransactionError extends Error {
  constructor(message: string, readonly rollbackWarnings: string[]) {
    super(message);
    this.name = 'TeamStoreTransactionError';
  }
}

export interface TeamTransactionWrite {
  parts: readonly [section: 'members' | 'skills' | 'roles' | 'teams', filename: string];
  content: string;
  mode: 'create' | 'replace';
}

interface JournalWrite extends TeamTransactionWrite {
  previousContent?: string;
}

interface TeamTransactionJournal {
  version: 2;
  key: string;
  writesDigest: string;
  writes: JournalWrite[];
}

const KEY = /^[a-z0-9][a-z0-9_-]{2,160}$/;
const JOURNAL = /^\.transaction-([a-z0-9][a-z0-9_-]{2,160})$/;
const MAX_WRITES = 512;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;

export async function executeDurableTeamTransaction(
  roomId: string,
  key: string,
  writes: TeamTransactionWrite[]
): Promise<{ rollbackWarnings: string[]; writtenPaths: string[] }> {
  assertTransactionInput(key, writes);
  const workspace = requireBoundRoomWorkspace(roomId);
  return withRoomDataLock(workspace.roomRoot, 'team-transactions', async () => {
    const existing = await readJournal(roomId, key);
    if (existing) {
      if (existing.writesDigest !== digestWrites(writes)) {
        throw new Error('Pending team transaction does not match this request.');
      }
      try {
        await applyJournal(roomId, existing);
        return {
          rollbackWarnings: [],
          writtenPaths: existing.writes.map(write => resolveWrite(roomId, write))
        };
      } catch (error) {
        const rollbackWarnings = await rollbackJournal(roomId, existing);
        throw new TeamStoreTransactionError(
          error instanceof Error ? error.message : String(error),
          rollbackWarnings
        );
      }
    }
    const journal = await prepareJournal(roomId, key, writes);
    await writeJournal(roomId, journal);
    try {
      await applyJournal(roomId, journal);
      return { rollbackWarnings: [], writtenPaths: writes.map(write => resolveWrite(roomId, write)) };
    } catch (error) {
      const rollbackWarnings = await rollbackJournal(roomId, journal);
      throw new TeamStoreTransactionError(
        error instanceof Error ? error.message : String(error),
        rollbackWarnings
      );
    }
  });
}

export async function reconcileTeamTransactions(roomId: string): Promise<void> {
  const teamsDirectory = resolveWithinRoomData(roomId, 'teams');
  let directory: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directory = await fs.opendir(teamsDirectory);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  const keys: string[] = [];
  try {
    for await (const entry of directory) {
      const key = entry.name.match(JOURNAL)?.[1];
      if (key) keys.push(key);
      if (keys.length > 100) throw new Error('ROOM has too many pending team transactions.');
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  for (const key of keys.sort()) {
    const snapshot = await readJournal(roomId, key);
    if (!snapshot) continue;
    await withJournalMutationLocks(roomId, snapshot, async () => {
      const workspace = requireBoundRoomWorkspace(roomId);
      await withRoomDataLock(workspace.roomRoot, 'team-transactions', async () => {
        const journal = await readJournal(roomId, key);
        if (journal) await applyJournal(roomId, journal);
      });
    });
  }
}

async function withJournalMutationLocks<T>(
  roomId: string,
  journal: TeamTransactionJournal,
  operation: () => Promise<T>
): Promise<T> {
  const workspace = requireBoundRoomWorkspace(roomId);
  const memberFilenames = journal.writes
    .filter(write => write.parts[0] === 'members')
    .map(write => write.parts[1]);
  const memberIds = memberFilenames.map(filename => filename.slice(0, -'.json'.length));
  const teamFilenames = journal.writes
    .filter(write => write.parts[0] === 'teams')
    .map(write => write.parts[1]);
  return withRoomMemberMutation(workspace, memberFilenames, async () => {
    await assertNoPendingMemberDeletions(roomId, memberIds);
    return withTeamMutation(roomId, teamFilenames, () =>
      withRoomStorageTransaction(workspace, async () => null, operation)
    );
  });
}

async function prepareJournal(
  roomId: string,
  key: string,
  writes: TeamTransactionWrite[]
): Promise<TeamTransactionJournal> {
  const prepared: JournalWrite[] = [];
  for (const write of writes) {
    const current = await readCurrent(resolveWrite(roomId, write));
    if (write.mode === 'create' && current !== undefined) {
      throw new Error(`Team transaction target already exists: ${write.parts[1]}`);
    }
    if (write.mode === 'replace' && current === undefined) {
      throw new Error(`Team transaction target is missing: ${write.parts[1]}`);
    }
    prepared.push({
      ...write,
      ...(current !== undefined ? { previousContent: current } : {})
    });
  }
  return {
    version: 2,
    key,
    writesDigest: digestWrites(writes),
    writes: prepared
  };
}

async function applyJournal(
  roomId: string,
  journal: TeamTransactionJournal
): Promise<void> {
  for (const write of journal.writes) {
    const target = resolveWrite(roomId, write);
    const current = await readCurrent(target);
    if (current === write.content) continue;
    if (write.mode === 'create' && current !== undefined) {
      throw new Error(`Team transaction conflicts with ${write.parts[1]}.`);
    }
    if (
      write.mode === 'replace'
      && current !== write.previousContent
    ) throw new Error(`Team transaction replacement conflicts with ${write.parts[1]}.`);
    await writeAtomically(target, write.content, write.mode === 'create');
  }
  await fs.unlink(journalPath(roomId, journal.key));
}

async function rollbackJournal(
  roomId: string,
  journal: TeamTransactionJournal
): Promise<string[]> {
  const warnings: string[] = [];
  for (const write of [...journal.writes].reverse()) {
    const target = resolveWrite(roomId, write);
    try {
      const current = await readCurrent(target);
      if (current === write.content) {
        if (write.mode === 'create') await fs.unlink(target);
        else await writeAtomically(target, write.previousContent!);
      } else if (
        (write.mode === 'create' && current !== undefined)
        || (write.mode === 'replace' && current !== write.previousContent)
      ) {
        warnings.push(target);
      }
    } catch {
      warnings.push(target);
    }
  }
  if (warnings.length === 0) {
    await fs.unlink(journalPath(roomId, journal.key)).catch((error: unknown) => {
      if (!hasErrorCode(error, 'ENOENT')) warnings.push(journalPath(roomId, journal.key));
    });
  }
  return warnings;
}

async function readJournal(
  roomId: string,
  key: string
): Promise<TeamTransactionJournal | null> {
  const content = await readCurrent(journalPath(roomId, key));
  if (content === undefined) return null;
  if (Buffer.byteLength(content, 'utf-8') > MAX_JOURNAL_BYTES) {
    throw new Error('ROOM team transaction journal exceeds its limit.');
  }
  const journal = JSON.parse(content) as TeamTransactionJournal;
  assertTransactionInput(journal.key, journal.writes);
  if (
    journal.version !== 2
    || journal.key !== key
    || !/^[a-f0-9]{64}$/.test(journal.writesDigest)
    || journal.writesDigest !== digestWrites(journal.writes)
  ) {
    throw new Error('ROOM team transaction journal is invalid.');
  }
  for (const write of journal.writes) {
    if (write.mode === 'replace' && typeof write.previousContent !== 'string') {
      throw new Error('ROOM team transaction journal is incomplete.');
    }
  }
  return journal;
}

function digestWrites(writes: readonly TeamTransactionWrite[]): string {
  return createHash('sha256').update(JSON.stringify(writes.map(write => ({
    parts: write.parts,
    content: write.content,
    mode: write.mode
  })))).digest('hex');
}

async function writeJournal(
  roomId: string,
  journal: TeamTransactionJournal
): Promise<void> {
  const content = JSON.stringify(journal);
  if (Buffer.byteLength(content, 'utf-8') > MAX_JOURNAL_BYTES) {
    throw new Error('ROOM team transaction journal exceeds its limit.');
  }
  await writeAtomically(journalPath(roomId, journal.key), content, true);
}

function assertTransactionInput(
  key: string,
  writes: readonly TeamTransactionWrite[]
): void {
  if (!KEY.test(key) || writes.length < 1 || writes.length > MAX_WRITES) {
    throw new Error('Invalid team transaction.');
  }
  const paths = new Set<string>();
  let bytes = 0;
  for (const write of writes) {
    if (
      !Array.isArray(write.parts)
      || write.parts.length !== 2
      || !['members', 'skills', 'roles', 'teams'].includes(write.parts[0])
      || path.basename(write.parts[1]) !== write.parts[1]
      || write.parts[1].startsWith('.')
      || (write.mode !== 'create' && write.mode !== 'replace')
      || typeof write.content !== 'string'
    ) throw new Error('Invalid team transaction write.');
    const identity = write.parts.join('/');
    if (paths.has(identity)) throw new Error('Duplicate write path in team transaction.');
    paths.add(identity);
    bytes += Buffer.byteLength(write.content, 'utf-8');
  }
  if (bytes > MAX_JOURNAL_BYTES / 2) {
    throw new Error('ROOM team transaction content exceeds its limit.');
  }
}

function resolveWrite(roomId: string, write: TeamTransactionWrite): string {
  return resolveWithinRoomData(roomId, ...write.parts);
}

function journalPath(roomId: string, key: string): string {
  if (!KEY.test(key)) throw new Error('Invalid team transaction key.');
  return resolveWithinRoomData(roomId, 'teams', `.transaction-${key}`);
}

async function readCurrent(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.lstat(filePath);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || stat.size > MAX_JOURNAL_BYTES
    ) throw new Error('ROOM team transaction file exceeds its read limit.');
    return await fs.readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

async function writeAtomically(
  destination: string,
  content: string,
  exclusive = false
): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  try {
    if (exclusive) await fs.link(temporary, destination);
    else await fs.rename(temporary, destination);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
