import { attachRoomSource, ensurePersonalRoom } from './roomHome.js';

const [, , roomHome, sourcePath] = process.argv;
if (!roomHome || !sourcePath) throw new Error('Room Home and Source path are required.');
await attachRoomSource(await ensurePersonalRoom(roomHome), sourcePath);
