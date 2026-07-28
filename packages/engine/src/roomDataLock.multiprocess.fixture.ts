import * as fs from 'fs/promises';
import * as path from 'path';
import { withRoomDataLock } from './roomDataLock.js';

const [roomRoot, participant] = process.argv.slice(2);
if (!roomRoot || !participant) {
  throw new Error('Expected room root and participant ID.');
}

await withRoomDataLock(roomRoot, 'stale-race', async () => {
  const activePath = path.join(roomRoot, '.critical-active');
  const violationPath = path.join(roomRoot, '.critical-violation');
  try {
    await fs.mkdir(activePath);
  } catch {
    await fs.writeFile(violationPath, participant, { flag: 'a' });
    throw new Error('Concurrent critical section detected.');
  }
  try {
    await new Promise(resolve => setTimeout(resolve, 75));
  } finally {
    await fs.rm(activePath, { recursive: true, force: true });
  }
});
