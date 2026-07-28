import { describe, expect, it } from 'vitest';
import {
  resolveOptionalParticipantSnapshot,
  resolveParticipantSnapshots
} from '../../main/ipc/participant-snapshot.js';
import { normalizeTemporaryAgents } from '../../main/ipc/temporary-agents.js';
import { taskParticipantEntries } from './features/task-run/taskParticipantRefs.js';

const saved = [
  {
    id: 'mem_first',
    name: 'Duplicate',
    role: 'First',
    provider: 'gemini',
    systemPrompt: 'First prompt'
  },
  {
    id: 'mem_second',
    name: 'Duplicate',
    role: 'Second',
    provider: 'gemini',
    systemPrompt: 'Second prompt'
  }
];

describe('run participant snapshots', () => {
  it('resolves duplicate display names by stable member identity and preserves order', () => {
    const result = resolveParticipantSnapshots(
      saved,
      [{
        id: 'tmp_reviewer',
        name: 'Duplicate',
        role: 'Temporary',
        provider: 'gemini',
        systemPrompt: 'Temporary prompt'
      }],
      ['member:mem_second', 'tmp:tmp_reviewer', 'member:mem_first']
    );

    expect(result.participants.map(agent => agent.systemPrompt)).toEqual([
      'Second prompt',
      'Temporary prompt',
      'First prompt'
    ]);
    expect(result.persistedParticipants.map(agent => agent.id)).toEqual([
      'mem_second',
      'mem_first'
    ]);
  });

  it('fails closed for stale or duplicate participant references', () => {
    expect(() => resolveOptionalParticipantSnapshot(
      saved,
      [],
      'member:mem_missing'
    )).toThrow('unavailable');
    expect(() => resolveParticipantSnapshots(
      saved,
      [],
      ['member:mem_first', 'member:mem_first']
    )).toThrow('Invalid AI member reference');
  });

  it('preserves validated temporary IDs across the Main boundary', () => {
    expect(normalizeTemporaryAgents([{
      id: 'tmp_reviewer',
      name: 'Temporary reviewer',
      role: 'Reviewer',
      provider: 'gemini',
      systemPrompt: 'Review independently.'
    }])).toMatchObject([{
      id: 'tmp_reviewer',
      name: 'Temporary reviewer'
    }]);
  });

  it('keeps duplicate task display names distinct in renderer selection values', () => {
    expect(taskParticipantEntries(saved, []).map(entry => entry.ref)).toEqual([
      'member:mem_first',
      'member:mem_second'
    ]);
  });
});
