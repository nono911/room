import * as path from 'path';

export type RoomSkillSource = 'skills' | 'roles';

export interface ParsedRoomSkillReference {
  reference: string;
  source: RoomSkillSource;
  filename: string;
}

const ROOM_SKILL_REFERENCE = /^room:\/\/(skills|roles)\/([^/\\]{1,255}\.md)$/i;

export function createRoomSkillReference(
  source: RoomSkillSource,
  filename: string
): string {
  const safeName = path.basename(filename.trim());
  if (
    !safeName
    || safeName !== filename.trim()
    || safeName.startsWith('.')
    || !safeName.toLowerCase().endsWith('.md')
  ) {
    throw new Error(`Unsafe Room skill filename: ${filename}`);
  }
  return `room://${source}/${safeName}`;
}

export function parseRoomSkillReference(
  value: unknown
): ParsedRoomSkillReference | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(ROOM_SKILL_REFERENCE);
  if (!match) return null;
  const source = match[1].toLowerCase() as RoomSkillSource;
  const filename = path.basename(match[2]);
  if (filename !== match[2] || filename.startsWith('.')) return null;
  return {
    reference: createRoomSkillReference(source, filename),
    source,
    filename
  };
}

export function isRoomSkillReference(value: unknown): value is string {
  return parseRoomSkillReference(value) !== null;
}
