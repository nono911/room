import { describe, expect, it } from 'vitest';
import { estimateTokenCount, trimTextToTokenBudget } from './tokenBudget.js';

describe('tokenBudget', () => {
  it('estimates Thai text more conservatively than English text with the same character count', () => {
    const english = 'a'.repeat(120);
    const thai = 'ก'.repeat(120);

    expect(estimateTokenCount(thai)).toBeGreaterThan(estimateTokenCount(english));
  });

  it('trims token-budgeted text at a readable boundary when possible', () => {
    const text = `Keep this paragraph intact.\n\n${'Drop this later paragraph. '.repeat(200)}`;
    const trimmed = trimTextToTokenBudget(text, 20);

    expect(trimmed.truncated).toBe(true);
    expect(trimmed.text).toBe('Keep this paragraph intact.');
  });

  it('bypasses early paragraph boundaries to avoid excessive truncation of later content', () => {
    // 35 characters of greeting, followed by 1000 characters of single-paragraph content.
    const greeting = 'Hi guys, hope you are doing well!\n\n';
    const bodySentence = 'This is a long sentence that should remain intact since it fits the budget. ';
    const text = `${greeting}${bodySentence.repeat(20)}`;
    
    // We request a budget that fits the greeting + 5 repetitions of bodySentence (about 400 chars)
    // The greeting paragraph break (at index 33) is way below 55% of 400.
    // So it should bypass the greeting break and slice at a sentence boundary in the body instead.
    const budgetTokens = 110; 
    const trimmed = trimTextToTokenBudget(text, budgetTokens);

    expect(trimmed.truncated).toBe(true);
    expect(trimmed.text).toContain('Hi guys');
    expect(trimmed.text.length).toBeGreaterThan(200); // Should keep most of the budget
    expect(trimmed.text.endsWith('.')).toBe(true); // Should end at a sentence boundary
  });
});
