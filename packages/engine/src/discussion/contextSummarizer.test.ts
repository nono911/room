import { describe, expect, it } from 'vitest';
import { shouldGenerateContextSummary, truncateSummary, updateContextSummary } from './contextSummarizer.js';

describe('contextSummarizer', () => {
  it('truncates long summaries at a readable boundary with an explicit note', () => {
    const summary = truncateSummary('First sentence. Second sentence keeps going.', 24);

    expect(summary).toBe('First sentence.\n\n[Summary truncated to 24 characters at the nearest readable boundary.]');
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

  it('sends the previous summary plus only the uncovered messages', async () => {
    let captured = '';
    const provider = {
      execute: async (prompt: string) => {
        captured = prompt;
        return 'updated summary';
      }
    };
    const messages = [0, 1, 2, 3].map(index => ({
      agentName: `Agent ${index}`,
      providerName: 'Claude',
      content: `content ${index}`,
      timestamp: '10:00'
    }));
    const result = await updateContextSummary(provider, 'sys', 'old summary', messages, [2, 3]);
    expect(result).toBe('updated summary');
    expect(captured).toContain('old summary');
    expect(captured).toContain('content 2');
    expect(captured).toContain('content 3');
    expect(captured).not.toContain('content 0');
  });
});
