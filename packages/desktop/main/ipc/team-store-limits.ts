import * as fs from 'fs/promises';
import { withRoomDataLock } from '@room/engine';
import {
  requireBoundRoomWorkspace,
  resolveWithinRoomData,
  safeReadDirWithStatus
} from './shared.js';

export const MAX_ROOM_TEAMS = 100;
export const MAX_TEAM_FILE_BYTES = 256 * 1024;
export const MAX_TEAM_AGGREGATE_BYTES = 2 * 1024 * 1024;
const MAX_TEAM_DIRECTORY_ENTRIES = 1_000;

export async function withTeamMutation<T>(
  roomId: string,
  teamFilenames: string[],
  operation: () => Promise<T>
): Promise<T> {
  if (
    teamFilenames.length > MAX_ROOM_TEAMS
    || teamFilenames.some(filename => (
      !filename.endsWith('.json')
      || filename.startsWith('.')
      || /[\\/]/.test(filename)
    ))
  ) {
    throw new Error('Invalid ROOM team mutation.');
  }
  const workspace = requireBoundRoomWorkspace(roomId);
  return withRoomDataLock(workspace.roomRoot, 'teams', async () => {
    const teamsDir = resolveWithinRoomData(roomId, 'teams');
    await fs.mkdir(teamsDir, { recursive: true });
    const listing = await safeReadDirWithStatus(teamsDir, MAX_TEAM_DIRECTORY_ENTRIES);
    if (listing.truncated) throw new Error('ROOM team directory exceeds its entry limit.');
    const existing = new Set(listing.files.filter(filename => filename.endsWith('.json')));
    const additions = new Set(teamFilenames.filter(filename => !existing.has(filename)));
    if (existing.size + additions.size > MAX_ROOM_TEAMS) {
      throw new Error(`A Room can contain at most ${MAX_ROOM_TEAMS} teams.`);
    }
    return operation();
  });
}
