import { describe, expect, it } from 'vitest';
import { createExecutionParticipantSnapshots } from './executionParticipants.js';

describe('execution participant audit snapshots', () => {
  it('persists stable identity and secret-free configuration/skill digests', () => {
    const [snapshot] = createExecutionParticipantSnapshots(
      'room_personal',
      [{
        id: 'tmp_reviewer',
        name: 'Reviewer',
        role: 'Security reviewer',
        provider: 'custom',
        modelName: 'model-a',
        systemPrompt: 'private system instructions',
        skills: ['room://skills/review.md', 'machine://codex/security']
      }],
      [{
        reference: 'room://skills/review.md',
        source: 'skills',
        autoMatched: false,
        contentDigest: 'a'.repeat(64),
        content: 'private skill content'
      }],
      [{
        memberId: 'tmp_reviewer',
        provider: 'custom',
        reference: 'machine://codex/security',
        contentDigest: 'b'.repeat(64),
        content: 'private machine skill content'
      }]
    );

    expect(snapshot).toMatchObject({
      roomId: 'room_personal',
      referenceKind: 'temporary',
      id: 'tmp_reviewer',
      name: 'Reviewer',
      role: 'Security reviewer',
      provider: 'custom',
      modelName: 'model-a'
    });
    expect(snapshot.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.skillSnapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });
});
