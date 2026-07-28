import { describe, expect, it } from 'vitest';
import { resolveCodingTaskParticipants } from './taskParticipants.js';

const agent = (id: string, name: string, role: string) => ({
  id,
  name,
  role,
  provider: 'gemini',
  systemPrompt: `${name} instructions`
});

describe('coding task participant resolution', () => {
  it('returns only the doer and effective reviewers', () => {
    const unrelated = agent('mem_unrelated', 'Unrelated', 'Researcher');
    const participants = resolveCodingTaskParticipants([
      agent('mem_doer', 'Doer', 'Developer'),
      agent('mem_reviewer', 'Reviewer', 'Reviewer'),
      unrelated
    ], 'Doer', ['Reviewer']);

    expect(participants.developer.id).toBe('mem_doer');
    expect(participants.reviewers.map(reviewer => reviewer.id)).toEqual(['mem_reviewer']);
    expect([participants.developer, ...participants.reviewers]).not.toContain(unrelated);
  });

  it('uses the same fallback reviewer the task runner will execute', () => {
    const participants = resolveCodingTaskParticipants([
      agent('mem_doer', 'Doer', 'Developer'),
      agent('mem_reviewer', 'Fallback', 'Lead Reviewer')
    ], 'Doer', []);

    expect(participants.reviewers.map(reviewer => reviewer.id)).toEqual(['mem_reviewer']);
  });

  it('rejects a missing explicitly selected Doer', () => {
    expect(() => resolveCodingTaskParticipants([
      agent('mem_doer', 'Doer', 'Developer'),
      agent('mem_reviewer', 'Reviewer', 'Reviewer')
    ], 'Missing', ['Reviewer'])).toThrow('Selected Doer');
  });

  it('rejects a partially stale reviewer selection', () => {
    expect(() => resolveCodingTaskParticipants([
      agent('mem_doer', 'Doer', 'Developer'),
      agent('mem_reviewer', 'Reviewer', 'Reviewer')
    ], 'Doer', ['Reviewer', 'Missing'])).toThrow('Selected Reviewer');
  });

  it('deduplicates explicit reviewers without substituting members', () => {
    const participants = resolveCodingTaskParticipants([
      agent('mem_doer', 'Doer', 'Developer'),
      agent('mem_reviewer', 'Reviewer', 'Reviewer')
    ], 'Doer', ['Reviewer', 'reviewer']);

    expect(participants.reviewers.map(reviewer => reviewer.id)).toEqual(['mem_reviewer']);
  });
});
