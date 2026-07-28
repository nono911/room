import type { WorkspaceInput } from '../workspace.js';
import { readRoomTextFile } from '../roomFile.js';
import { MAX_RUN_ARTIFACT_BYTES } from './runArtifact.js';
import {
  isSameExecutionSource,
  type CodingTaskResult,
  type SourceProvenance
} from './types.js';
import { parseTaskCanonical } from './taskCanonical.js';

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function readTaskResult(
  workspace: WorkspaceInput,
  taskId: string
): Promise<CodingTaskResult | null> {
  try {
    const parsed = parseTaskCanonical(await readRoomTextFile(
      workspace,
      ['tasks', `${taskId}.json`],
      MAX_RUN_ARTIFACT_BYTES
    )) as Partial<CodingTaskResult>;
    if (parsed.id !== taskId) {
      throw new Error(`Task ${taskId} has an invalid persisted identity.`);
    }
    return parsed as CodingTaskResult;
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

function requireMatchingProvenance(
  result: CodingTaskResult,
  executionProvenance: SourceProvenance,
  label: string
): void {
  if (!result.sourceProvenance) {
    throw new Error(`${label} cannot continue because it has no recorded Source provenance.`);
  }
  if (!isSameExecutionSource(result.sourceProvenance, executionProvenance)) {
    throw new Error('A run cannot continue under a different Source.');
  }
}

export async function validateTaskLineage(
  workspace: WorkspaceInput,
  taskId: string,
  continuedFromTaskId: string | undefined,
  executionProvenance: SourceProvenance
): Promise<CodingTaskResult | null> {
  const existingResult = await readTaskResult(workspace, taskId);
  if (existingResult) {
    requireMatchingProvenance(existingResult, executionProvenance, 'The existing task');
    throw new Error(`Task ${taskId} already exists. Start a new task run instead.`);
  }

  if (continuedFromTaskId) {
    const parent = await readTaskResult(workspace, continuedFromTaskId);
    if (!parent) {
      throw new Error(`Continued task parent ${continuedFromTaskId} does not exist.`);
    }
    requireMatchingProvenance(parent, executionProvenance, 'The continued task parent');
  }

  return existingResult;
}
