import { createHash } from 'crypto';
import { listDirectoryNamesBounded } from '../boundedFs.js';
import { readRoomTextFile } from '../roomFile.js';
import { isMachineSkillReference } from '../skills/machineCatalog.js';
import {
  createRoomSkillReference,
  parseRoomSkillReference
} from '../skills/roomSkillReference.js';
import { parseSkillFrontmatter } from '../skills/parser.js';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';
import { globToRegex } from './globPattern.js';

export interface RoomSkillSnapshot {
  reference: string;
  source: 'skills' | 'roles';
  autoMatched: boolean;
  contentDigest: string;
  content: string;
}

export interface RoomSkillSnapshotOptions {
  references?: readonly string[];
  mentionedFilePaths?: readonly string[];
  discussionText?: string;
}

const MAX_SKILLS_PER_SECTION = 1_000;
const MAX_SKILL_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export async function snapshotRoomSkills(
  workspace: WorkspaceInput,
  options: RoomSkillSnapshotOptions = {}
): Promise<RoomSkillSnapshot[]> {
  const snapshots: RoomSkillSnapshot[] = [];
  const seen = new Set<string>();
  let aggregateBytes = 0;
  const addSnapshot = (
    reference: string,
    source: RoomSkillSnapshot['source'],
    content: string,
    autoMatched: boolean
  ): void => {
    if (seen.has(reference)) return;
    aggregateBytes += Buffer.byteLength(content, 'utf-8');
    if (aggregateBytes > MAX_SNAPSHOT_BYTES) {
      throw new Error('Active ROOM skill content exceeds the run snapshot capacity.');
    }
    seen.add(reference);
    snapshots.push({
      reference,
      source,
      autoMatched,
      contentDigest: digest(content),
      content
    });
  };

  const references = Array.from(new Set(
    (options.references || [])
      .filter(reference => !isMachineSkillReference(reference))
      .map(reference => parseRoomSkillReference(reference)?.reference)
      .filter((reference): reference is string => Boolean(reference))
  )).sort();
  for (const reference of references) {
    const parsed = parseRoomSkillReference(reference)!;
    const content = await readRoomTextFile(
      workspace,
      [parsed.source, parsed.filename],
      MAX_SKILL_BYTES
    );
    addSnapshot(
      reference,
      parsed.source,
      content,
      parsed.source === 'skills' && matchesRun(content, options)
    );
  }

  const skillsDirectory = resolveRoomPath(workspace, 'skills');
  try {
    const listing = await listDirectoryNamesBounded(
      skillsDirectory,
      MAX_SKILLS_PER_SECTION
    );
    for (const reference of listing.names.sort()) {
      if (
        seen.has(reference)
        || !reference.toLowerCase().endsWith('.md')
      ) continue;
      let content: string;
      try {
        content = await readRoomTextFile(
          workspace,
          ['skills', reference],
          MAX_SKILL_BYTES
        );
      } catch {
        // An inactive malformed or oversized skill must not disable unrelated runs.
        continue;
      }
      if (matchesRun(content, options)) {
        addSnapshot(
          createRoomSkillReference('skills', reference),
          'skills',
          content,
          true
        );
      }
    }
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
  return snapshots;
}

export function autoMatchedRoomSkillReferences(
  snapshots: readonly RoomSkillSnapshot[]
): string[] {
  return snapshots
    .filter(snapshot => snapshot.autoMatched)
    .map(snapshot => snapshot.reference);
}

function matchesRun(
  content: string,
  options: RoomSkillSnapshotOptions
): boolean {
  try {
    const { metadata } = parseSkillFrontmatter(content);
    if (metadata.alwaysApply) return true;
    const matchesGlob = Boolean(metadata.globs?.some(pattern => {
      const regex = globToRegex(pattern);
      return (options.mentionedFilePaths || []).some(filePath => regex.test(filePath));
    }));
    const normalizedText = (options.discussionText || '').toLowerCase();
    const matchesKeyword = Boolean(
      normalizedText
      && metadata.triggerKeywords?.some(keyword => (
        normalizedText.includes(keyword.toLowerCase())
      ))
    );
    return matchesGlob || matchesKeyword;
  } catch {
    return false;
  }
}

export function roomSkillSnapshotContent(
  snapshots: readonly RoomSkillSnapshot[],
  reference: string
): string | undefined {
  const parsed = parseRoomSkillReference(reference);
  if (!parsed) return undefined;
  const snapshot = snapshots.find(item => (
    item.reference === parsed.reference
    && item.source === parsed.source
    && item.contentDigest === digest(item.content)
  ));
  return snapshot?.content;
}

function digest(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
