import { randomUUID } from 'crypto';
import * as path from 'path';
import type { RoomManifest, RoomSource } from './roomHome.js';

const MAX_DETACHED_SOURCES = 256;

interface AttachSourceInput {
  name?: string;
  resolvedPath: string;
  canonicalPath: string;
  rootDevice: string;
  rootInode: string;
  rootBirthtimeNs: string;
  storedIdentity: Pick<
    RoomSource,
    'id' | 'type' | 'attachedAt' | 'rootDevice' | 'rootInode' | 'rootBirthtimeNs'
  > | null;
}

export function attachSourceToManifest(
  manifest: RoomManifest,
  input: AttachSourceInput
): RoomManifest {
  const sameIdentity = (source: RoomSource): boolean => (
    source.rootDevice === input.rootDevice
    && source.rootInode === input.rootInode
    && source.rootBirthtimeNs === input.rootBirthtimeNs
  );
  const existing = manifest.sources.find(sameIdentity);
  const detached = (manifest.detachedSources || []).find(sameIdentity);
  const replacedAtPath = manifest.sources.find(source => (
    source.canonicalPath === input.canonicalPath && !sameIdentity(source)
  ));
  const now = new Date().toISOString();
  const source: RoomSource = {
    ...(existing || detached || input.storedIdentity || {
      id: `source_${randomUUID().replace(/-/g, '')}`,
      type: 'directory',
      attachedAt: now
    }),
    name: input.name?.trim() || path.basename(input.canonicalPath),
    path: input.resolvedPath,
    canonicalPath: input.canonicalPath,
    rootDevice: input.rootDevice,
    rootInode: input.rootInode,
    rootBirthtimeNs: input.rootBirthtimeNs
  };
  return {
    ...manifest,
    // The Source that used to own this path is detached either way, otherwise
    // two attached Sources would claim one canonical path.
    sources: existing
      ? manifest.sources
        .filter(candidate => candidate.id !== replacedAtPath?.id)
        .map(candidate => candidate.id === existing.id ? source : candidate)
      : [
          ...manifest.sources.filter(candidate => candidate.id !== replacedAtPath?.id),
          source
        ],
    detachedSources: [
      ...(manifest.detachedSources || []).filter(candidate => (
        candidate.id !== source.id && candidate.id !== replacedAtPath?.id
      )),
      ...(replacedAtPath ? [replacedAtPath] : [])
    ].slice(-MAX_DETACHED_SOURCES),
    activeSourceId: source.id,
    updatedAt: now,
    lastOpenedAt: now
  };
}
