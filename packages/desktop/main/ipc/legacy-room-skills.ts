import * as fs from 'fs/promises';
import * as path from 'path';
import {
  readTextFileWithLimit,
  requireBoundRoom,
  requireBoundSource,
  resolveCanonicalWithinProject,
  resolveWithinRoomData,
  safeReadDirWithStatus
} from './shared.js';
import { writeRoomDataFileAtomically } from './room-file-write.js';

const LEGACY_SKILL_FILE_LIMIT_BYTES = 200 * 1024;
const LEGACY_SKILL_ENTRY_LIMIT = 1_000;

export interface LegacyRoomSkillImportResult {
  imported: number;
  skipped: number;
  truncated: boolean;
}

export async function importLegacyRoomSkills(
  roomId: string
): Promise<LegacyRoomSkillImportResult> {
  const room = requireBoundRoom(roomId);
  const result: LegacyRoomSkillImportResult = {
    imported: 0,
    skipped: 0,
    truncated: false
  };

  for (const sourceSummary of room.manifest.sources) {
    const source = requireBoundSource(roomId, sourceSummary.id);
    for (const section of ['skills', 'roles'] as const) {
      let legacyDirectory: string;
      try {
        legacyDirectory = await resolveCanonicalWithinProject(
          source.canonicalPath,
          '.room',
          section
        );
      } catch {
        continue;
      }

      const listing = await safeReadDirWithStatus(
        legacyDirectory,
        LEGACY_SKILL_ENTRY_LIMIT
      );
      result.truncated ||= listing.truncated;

      for (const filename of listing.files) {
        if (
          !filename.toLowerCase().endsWith('.md')
          || filename.startsWith('.')
          || path.basename(filename) !== filename
        ) {
          continue;
        }

        const destination = resolveWithinRoomData(roomId, section, filename);
        const destinationExists = await fs.lstat(destination)
          .then(() => true)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          });
        if (destinationExists) {
          result.skipped += 1;
          continue;
        }

        try {
          const content = await readTextFileWithLimit(
            path.join(legacyDirectory, filename),
            LEGACY_SKILL_FILE_LIMIT_BYTES
          );
          await writeRoomDataFileAtomically(
            roomId,
            [section, filename],
            content
          );
          result.imported += 1;
        } catch {
          result.skipped += 1;
        }
      }
    }
  }

  return result;
}
