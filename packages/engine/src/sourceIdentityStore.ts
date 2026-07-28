import * as path from 'path';
import { listDirectoryNamesBounded } from './boundedFs.js';
import { readRoomTextFile, writeRoomTextFile } from './roomFile.js';
import type { RoomSource } from './roomHome.js';

const MAX_SOURCE_STATE_DIRECTORIES = 10_000;

interface StoredSourceIdentity {
  id: string;
  type: 'directory';
  attachedAt: string;
  rootDevice: string;
  rootInode: string;
  rootBirthtimeNs: string;
}

export async function findStoredSourceIdentity(
  roomId: string,
  roomRoot: string,
  rootDevice: string,
  rootInode: string,
  rootBirthtimeNs: string
): Promise<StoredSourceIdentity | null> {
  const listing = await listDirectoryNamesBounded(
    path.join(roomRoot, 'sources'),
    MAX_SOURCE_STATE_DIRECTORIES
  );
  if (listing.truncated) throw new Error('ROOM Source identity index exceeds its capacity.');
  for (const id of listing.names) {
    if (!/^source_[a-f0-9]{32}$/.test(id)) continue;
    try {
      const value = JSON.parse(await readRoomTextFile(
        { roomId, roomRoot },
        ['sources', id, 'identity.json'],
        4 * 1024
      )) as Partial<StoredSourceIdentity>;
      if (
        value.id === id
        && value.type === 'directory'
        && typeof value.attachedAt === 'string'
        && value.rootDevice === rootDevice
        && value.rootInode === rootInode
        && value.rootBirthtimeNs === rootBirthtimeNs
      ) return value as StoredSourceIdentity;
    } catch {
      // Invalid unrelated Source identity records do not authorize reassociation.
    }
  }
  return null;
}

export async function persistSourceIdentity(
  roomId: string,
  roomRoot: string,
  source: RoomSource
): Promise<void> {
  const identity: StoredSourceIdentity = {
    id: source.id,
    type: source.type,
    attachedAt: source.attachedAt,
    rootDevice: source.rootDevice,
    rootInode: source.rootInode,
    rootBirthtimeNs: source.rootBirthtimeNs
  };
  await writeRoomTextFile(
    { roomId, roomRoot },
    ['sources', source.id, 'identity.json'],
    `${JSON.stringify(identity, null, 2)}\n`
  );
}
