export type RoomSkillSource = 'skills' | 'roles';

export function roomSkillReference(
  source: RoomSkillSource,
  filename: string
): string {
  return `room://${source}/${filename}`;
}

export function parseRoomSkillReference(reference: string): {
  source: RoomSkillSource;
  filename: string;
} | null {
  const match = reference.match(/^room:\/\/(skills|roles)\/([^/\\]+\.md)$/i);
  return match
    ? {
        source: match[1].toLowerCase() as RoomSkillSource,
        filename: match[2]
      }
    : null;
}

export function roomSkillLabel(reference: string): string {
  const parsed = parseRoomSkillReference(reference);
  if (!parsed) return reference;
  return `${parsed.filename.replace(/\.md$/i, '').replace(/[-_]+/g, ' ')} · ${parsed.source === 'roles' ? 'Role' : 'Skill'}`;
}
