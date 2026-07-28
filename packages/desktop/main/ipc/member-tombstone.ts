import * as fs from 'fs/promises';
import { resolveWithinRoomData } from './shared.js';

const MEMBER_ID = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;

export async function assertNoPendingMemberDeletions(
  roomId: string,
  memberIds: readonly string[]
): Promise<void> {
  for (const memberId of memberIds) {
    if (!MEMBER_ID.test(memberId)) throw new Error('Invalid member id.');
    const tombstone = resolveWithinRoomData(
      roomId,
      'members',
      `.deleting-${memberId}`
    );
    const exists = await fs.lstat(tombstone)
      .then(() => true)
      .catch((error: unknown) => {
        if (hasErrorCode(error, 'ENOENT')) return false;
        throw error;
      });
    if (exists) {
      throw new Error(
        `AI member ${memberId} has a pending deletion that must be reconciled.`
      );
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
