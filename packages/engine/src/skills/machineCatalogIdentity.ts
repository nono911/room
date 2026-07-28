import * as path from 'path';
import type { MachineSkillSource } from './machineCatalog.js';

export function buildSkillIdentity(
  source: MachineSkillSource,
  relativeDirectory: string,
  metadataName?: string
): string | null {
  if (source !== 'plugin') {
    return relativeDirectory || metadataName?.trim() || null;
  }
  const parts = relativeDirectory.split('/').filter(Boolean);
  const skillsIndex = parts.lastIndexOf('skills');
  if (skillsIndex >= 3 && parts.length > skillsIndex + 1) {
    return [parts[0], parts[1], ...parts.slice(skillsIndex + 1)].join('/');
  }
  return relativeDirectory || metadataName?.trim() || null;
}

export function buildMachineSkillSourceLabel(
  source: MachineSkillSource,
  sourceLabel: string,
  relativeDirectory: string
): string {
  if (source !== 'plugin') return sourceLabel;
  const parts = relativeDirectory.split('/').filter(Boolean);
  return parts[1] ? `${sourceLabel} · ${parts[1]}` : sourceLabel;
}

export function isWithinMachineSkillRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, midpoint), 'utf-8') <= maxBytes) low = midpoint;
    else high = midpoint - 1;
  }
  return value.slice(0, low);
}
