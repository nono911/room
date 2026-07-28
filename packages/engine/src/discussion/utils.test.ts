import { describe, expect, it } from 'vitest';
import { executeAgentStep, parseSkipTurn } from './utils.js';

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

  it('never persists or emits raw provider fault details', async () => {
    const events: unknown[] = [];
    const sentinel = 'provider-private-sentinel';
    const result = await executeAgentStep(
      {
        name: 'Test',
        execute: async () => {
          throw new Error(sentinel);
        }
      },
      {
        name: 'Doer',
        role: 'Developer',
        provider: 'gemini',
        systemPrompt: 'Build safely.'
      },
      'prompt',
      'system',
      '/room/source',
      'task-test',
      1,
      [],
      { onEvent: event => events.push(event) }
    );
    expect(JSON.stringify({ result, events })).not.toContain(sentinel);
    expect(result.output).toContain('Provider execution failed');
  });
});
