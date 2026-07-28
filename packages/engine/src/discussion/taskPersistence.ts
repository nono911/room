import type { WorkspaceInput } from '../workspace.js';
import { writeRoomTextFile } from '../roomFile.js';
import type { CodingTaskResult } from './types.js';
import { serializeTaskCanonical } from './taskCanonical.js';

export async function saveCodingTaskResult(
  workspace: WorkspaceInput,
  result: CodingTaskResult
): Promise<void> {
  await writeRoomTextFile(
    workspace,
    ['tasks', result.jsonFilename],
    serializeTaskCanonical(result)
  );
}
