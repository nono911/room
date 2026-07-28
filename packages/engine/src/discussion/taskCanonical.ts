import type { CodingTaskResult } from './types.js';
import {
  assertBoundedRunArtifact,
  serializeBoundedRunArtifact
} from './runArtifact.js';

export interface TaskCanonicalHeader {
  id: string;
  title: string;
  status: string;
  cycles: number;
  statusSummary?: string;
  associatedCardId?: string;
  sourceProvenance?: CodingTaskResult['sourceProvenance'];
}

export function serializeTaskCanonical(result: CodingTaskResult): string {
  const header: TaskCanonicalHeader = {
    id: result.id,
    title: result.title,
    status: result.status,
    cycles: result.cycles,
    statusSummary: result.statusSummary,
    associatedCardId: result.associatedCardId,
    sourceProvenance: result.sourceProvenance
  };
  return assertBoundedRunArtifact(
    `${JSON.stringify(header)}\n${serializeBoundedRunArtifact(result, 'Task transcript')}`,
    'Task canonical record'
  );
}

export function parseTaskCanonical(content: string): CodingTaskResult {
  const newline = content.indexOf('\n');
  if (newline > 0) {
    return JSON.parse(content.slice(newline + 1)) as CodingTaskResult;
  }
  return JSON.parse(content) as CodingTaskResult;
}

export function parseTaskCanonicalHeader(prefix: string): TaskCanonicalHeader {
  const newline = prefix.indexOf('\n');
  if (newline < 1) {
    const result = JSON.parse(prefix) as CodingTaskResult;
    return {
      id: result.id,
      title: result.title,
      status: result.status,
      cycles: result.cycles,
      statusSummary: result.statusSummary,
      associatedCardId: result.associatedCardId,
      sourceProvenance: result.sourceProvenance
    };
  }
  return JSON.parse(prefix.slice(0, newline)) as TaskCanonicalHeader;
}
