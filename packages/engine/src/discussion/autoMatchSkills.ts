import { listDirectoryNamesBounded } from '../boundedFs.js';
import { readRoomTextFile } from '../roomFile.js';
import { parseSkillFrontmatter } from '../skills/parser.js';
import {
  createRoomSkillReference,
  parseRoomSkillReference
} from '../skills/roomSkillReference.js';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';
import { globToRegex } from './globPattern.js';
import type { RoomSkillSnapshot } from './roomSkillSnapshot.js';

export async function autoMatchSkills(
  workspace: WorkspaceInput,
  mentionedFilePaths: string[],
  discussionText: string,
  roomSkillSnapshots?: readonly RoomSkillSnapshot[]
): Promise<string[]> {
  const skillsDir = resolveRoomPath(workspace, 'skills');
  const matchedSkillFiles: string[] = [];

  try {
    const candidates = roomSkillSnapshots === undefined
      ? (await listDirectoryNamesBounded(skillsDir, 1_000)).names.map(reference => ({
          reference: createRoomSkillReference('skills', reference),
          filename: reference,
          content: undefined as string | undefined
        }))
      : roomSkillSnapshots
          .filter(snapshot => snapshot.source === 'skills')
          .map(snapshot => ({
            reference: snapshot.reference,
            filename: parseRoomSkillReference(snapshot.reference)?.filename || '',
            content: snapshot.content
          }));
    for (const candidate of candidates) {
      const file = candidate.reference;
      if (!candidate.filename) continue;

      try {
        const rawContent = candidate.content
          ?? await readRoomTextFile(workspace, ['skills', candidate.filename], 512 * 1024);
        const { metadata } = parseSkillFrontmatter(rawContent);

        if (metadata.alwaysApply) {
          matchedSkillFiles.push(file);
          continue;
        }

        const matchesGlob = Boolean(
          metadata.globs?.some(pattern => {
            const regex = globToRegex(pattern);
            return mentionedFilePaths.some(filePath => regex.test(filePath));
          })
        );
        const normalizedText = discussionText.toLowerCase();
        const matchesKeyword = Boolean(
          normalizedText
          && metadata.triggerKeywords?.some(keyword => (
            normalizedText.includes(keyword.toLowerCase())
          ))
        );

        if (matchesGlob || matchesKeyword) matchedSkillFiles.push(file);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error auto-matching skill file ${file}:`, message);
      }
    }
  } catch {}

  return matchedSkillFiles;
}
