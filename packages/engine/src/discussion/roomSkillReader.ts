import { readRoomTextFile } from '../roomFile.js';
import { parseRoomSkillReference } from '../skills/roomSkillReference.js';
import type { WorkspaceInput } from '../workspace.js';

export async function readRoomSkill(
  workspace: WorkspaceInput,
  skillFile: string
): Promise<string> {
  const parsed = parseRoomSkillReference(skillFile);
  if (!parsed) throw new Error(`Unsafe Room skill reference: ${skillFile}`);
  return readRoomTextFile(
    workspace,
    [parsed.source, parsed.filename],
    512 * 1024
  );
}
