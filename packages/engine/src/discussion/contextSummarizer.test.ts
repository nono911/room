import { describe, expect, it } from 'vitest';
import { shouldGenerateContextSummary, truncateSummary } from './contextSummarizer.js';

describe('contextSummarizer', () => {
  it('truncates long summaries with an explicit note', () => {
    const summary = truncateSummary('abcdefghij', 6);

    expect(summary).toBe('abcdef\n\n[Summary truncated to 6 characters.]');
  });

  it('generates summaries only after message or character thresholds', () => {
    const messages = [
      { type: 'user' as const, agentName: 'You', providerName: 'User', content: 'short', timestamp: '10:00' },
      { type: 'agent' as const, agentName: 'A', providerName: 'Local CLI', content: 'x'.repeat(20), timestamp: '10:01' }
    ];

    expect(shouldGenerateContextSummary(messages, [0], {
      minSummaryCandidateMessages: 2,
      minSummaryCandidateChars: 100,
      maxSummaryChars: 6000
    })).toBe(false);
    expect(shouldGenerateContextSummary(messages, [0, 1], {
      minSummaryCandidateMessages: 2,
      minSummaryCandidateChars: 100,
      maxSummaryChars: 6000
    })).toBe(true);
    expect(shouldGenerateContextSummary(messages, [1], {
      minSummaryCandidateMessages: 99,
      minSummaryCandidateChars: 10,
      maxSummaryChars: 6000
    })).toBe(true);
  });
});
