import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { RoomManifest, RoomSource } from './roomHome.js';

export function isRoomSourceShape(source: unknown): source is RoomSource {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const item = source as Record<string, unknown>;
  const bounded = (value: unknown, maxBytes: number): value is string => (
    typeof value === 'string'
    && Buffer.byteLength(value, 'utf-8') > 0
    && Buffer.byteLength(value, 'utf-8') <= maxBytes
  );
  return typeof item.id === 'string'
    && /^source_[a-f0-9]{32}$/.test(item.id)
    && item.type === 'directory'
    && bounded(item.name, 512)
    && bounded(item.path, 4096)
    && bounded(item.canonicalPath, 4096)
    && bounded(item.rootDevice, 32)
    && /^\d+$/.test(item.rootDevice)
    && bounded(item.rootInode, 32)
    && /^\d+$/.test(item.rootInode)
    && bounded(item.rootBirthtimeNs, 32)
    && /^\d+$/.test(item.rootBirthtimeNs)
    && bounded(item.attachedAt, 64);
}

function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateSourceShape(
  manifest: RoomManifest,
  canonicalRoomHome: string
): void {
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const source of [...manifest.sources, ...(manifest.detachedSources || [])]) {
    const identity = [
      source.rootDevice,
      source.rootInode,
      source.rootBirthtimeNs
    ].join(':');
    if (ids.has(source.id) || identities.has(identity)) {
      throw new Error('Room manifest contains duplicate Sources.');
    }
    ids.add(source.id);
    identities.add(identity);
    if (!path.isAbsolute(source.path) || !path.isAbsolute(source.canonicalPath)) {
      throw new Error('Room manifest contains a non-absolute Source path.');
    }
    if (
      source.canonicalPath === path.parse(source.canonicalPath).root
      || isSameOrNestedPath(canonicalRoomHome, source.canonicalPath)
      || isSameOrNestedPath(source.canonicalPath, canonicalRoomHome)
    ) {
      throw new Error(`Room manifest contains an unsafe Source: ${source.id}`);
    }
  }
  if (new Set(manifest.sources.map(source => source.canonicalPath)).size !== manifest.sources.length) {
    throw new Error('Room manifest contains duplicate attached Source paths.');
  }
}

export async function assertManifestSources(
  manifest: RoomManifest,
  roomRoot: string
): Promise<void> {
  const roomHome = path.dirname(path.dirname(roomRoot));
  const canonicalRoomHome = await fs.realpath(roomHome);
  validateSourceShape(manifest, canonicalRoomHome);
}

export function assertManifestSourcesSync(
  manifest: RoomManifest,
  roomRoot: string
): void {
  const roomHome = path.dirname(path.dirname(roomRoot));
  const canonicalRoomHome = fsSync.realpathSync(roomHome);
  validateSourceShape(manifest, canonicalRoomHome);
}
