import { describe, expect, it } from 'vitest';
import { resolveDiscussionParticipants } from './discussionParticipants.js';

const agent = (id: string | undefined, name: string) => ({
  id,
  name,
  role: 'Reviewer',
  provider: 'gemini',
  systemPrompt: 'Review.'
});

describe('discussion participant resolution', () => {
  it('uses a temporary name shadow and authorizes no unused persisted member', () => {
    const persisted = agent('mem_alex', 'Alex');
    const temporary = agent(undefined, 'Alex');
    const resolved = resolveDiscussionParticipants(
      [persisted],
      [temporary],
      ['Alex', 'alex']
    );

    expect(resolved.participants).toEqual([temporary]);
    expect(resolved.persistedParticipants).toEqual([]);
  });

  it('returns the exact saved members that will execute', () => {
    const alex = agent('mem_alex', 'Alex');
    const sam = agent('mem_sam', 'Sam');
    const resolved = resolveDiscussionParticipants([alex, sam], [], ['Sam']);

    expect(resolved.participants).toEqual([sam]);
    expect(resolved.persistedParticipants).toEqual([sam]);
  });
});
