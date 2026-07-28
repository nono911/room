import { describe, expect, it } from 'vitest';
import {
  assertBoundedRunArtifact,
  MAX_RUN_ARTIFACT_BYTES,
  serializeBoundedRunArtifact
} from './runArtifact.js';

describe('run artifact bounds', () => {
  it('rejects persisted transcripts above the hard limit', () => {
    expect(() => assertBoundedRunArtifact(
      'x'.repeat(MAX_RUN_ARTIFACT_BYTES + 1),
      'Task transcript'
    )).toThrow('8 MiB run artifact limit');
  });

  it('serializes bounded transcript data', () => {
    expect(serializeBoundedRunArtifact({ id: 'task-small' }, 'Task transcript'))
      .toContain('task-small');
  });
});
