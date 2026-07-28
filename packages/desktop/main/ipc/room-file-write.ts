import { writeRoomTextFile } from '@room/engine';
import { requireBoundRoomWorkspace } from './shared.js';

export async function writeRoomDataFileAtomically(
  roomId: string,
  parts: string[],
  content: string,
  _mode = 0o600
): Promise<void> {
  await writeRoomTextFile(requireBoundRoomWorkspace(roomId), parts, content);
}
