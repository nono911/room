import * as fs from 'fs/promises';
import {
  withRoomMemberMutation,
  withRoomStorageReconciliation
} from '@room/engine';
import {
  requireBoundRoomWorkspace,
  resolveWithinRoomData
} from './shared.js';
import {
  assertMemberTeamCleanupReadable,
  removeMemberFromTeams
} from './team-store.js';
import {
  assertMachineSkillGrantLedgerReadable,
  revokeMachineSkillGrants
} from './machine-skill-grants.js';

const MEMBER_ID = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;
const TOMBSTONE = /^\.deleting-(mem_[a-z0-9][a-z0-9_-]{2,80})$/;

export async function deleteMemberDurably(
  roomId: string,
  memberId: string
): Promise<void> {
  if (!MEMBER_ID.test(memberId)) throw new Error('Invalid member id.');
  await reconcilePendingMemberDeletions(roomId);
  await withRoomMemberMutation(
    requireBoundRoomWorkspace(roomId),
    [`${memberId}.json`],
    () => deleteMemberLocked(roomId, memberId, true)
  );
}

export async function reconcilePendingMemberDeletions(
  roomId: string
): Promise<void> {
  const membersDir = resolveWithinRoomData(roomId, 'members');
  const names: string[] = [];
  let directory;
  try {
    directory = await fs.opendir(membersDir);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  try {
    for await (const entry of directory) {
      names.push(entry.name);
      if (names.length > 8_193) {
        throw new Error('ROOM member directory exceeds its recovery limit.');
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  for (const name of names) {
    const memberId = name.match(TOMBSTONE)?.[1];
    if (!memberId) continue;
    await withRoomMemberMutation(
      requireBoundRoomWorkspace(roomId),
      [`${memberId}.json`],
      () => deleteMemberLocked(roomId, memberId, false)
    );
  }
}

async function deleteMemberLocked(
  roomId: string,
  memberId: string,
  preflight: boolean
): Promise<void> {
  if (preflight) {
    await Promise.all([
      assertMemberTeamCleanupReadable(roomId),
      assertMachineSkillGrantLedgerReadable(roomId)
    ]);
  }
  const canonical = resolveWithinRoomData(roomId, 'members', `${memberId}.json`);
  const tombstone = resolveWithinRoomData(roomId, 'members', `.deleting-${memberId}`);
  if (preflight) {
    if (await pathExists(tombstone)) {
      throw new Error('A pending deletion must be reconciled before deleting this member.');
    }
    try {
      await fs.rename(canonical, tombstone);
    } catch (error: unknown) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }
  } else if (await pathExists(canonical)) {
    throw new Error('ROOM cannot reconcile a member deletion with a conflicting member file.');
  }
  await revokeMachineSkillGrants(roomId, memberId);
  await removeMemberFromTeams(roomId, memberId);
  await withRoomStorageReconciliation(
    requireBoundRoomWorkspace(roomId),
    () => fs.unlink(tombstone).catch((error: unknown) => {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    })
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}
