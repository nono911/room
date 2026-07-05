import { describe, expect, it } from 'vitest';
import { parseSkipTurn } from './utils.js';

describe('parseSkipTurn', () => {
  it('parses a skip response into its one-line reason', () => {
    expect(parseSkipTurn('SKIP: nothing to add beyond Message 4')).toBe('nothing to add beyond Message 4');
  });

  it('trims and keeps only the first line of the reason', () => {
    expect(parseSkipTurn('SKIP: agreed with prior round\nextra trailing line')).toBe('agreed with prior round');
  });

  it('returns a default reason when the reason is empty', () => {
    expect(parseSkipTurn('SKIP:   ')).toBe('No additional points.');
  });

  it('returns null for normal responses', () => {
    expect(parseSkipTurn('I think we should use SQLite here.')).toBeNull();
  });

  it('returns null when SKIP is not at the start', () => {
    expect(parseSkipTurn('We could SKIP: this step')).toBeNull();
  });

  it('returns null for long responses that merely start with SKIP:', () => {
    expect(parseSkipTurn(`SKIP: ${'x'.repeat(500)}`)).toBeNull();
  });
});
