import { describe, expect, it } from 'vitest';
import {
  getFallbackModels,
  LOCAL_CLI_FALLBACK_MODELS
} from './modelCatalog.js';

describe('local CLI model catalog', () => {
  it('offers the current Claude Code aliases and Claude model IDs', () => {
    const ids = LOCAL_CLI_FALLBACK_MODELS.claude.map(model => model.value);
    expect(ids).toEqual(expect.arrayContaining([
      'fable',
      'opus',
      'sonnet',
      'haiku',
      'claude-fable-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5'
    ]));
    expect(ids).not.toContain('claude-3-5-sonnet-latest');
  });

  it('offers the current GPT-5.6 family to Codex CLI', () => {
    const ids = getFallbackModels('codex').map(model => model.value);
    expect(ids.slice(0, 5)).toEqual([
      'default',
      'gpt-5.6',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna'
    ]);
    expect(ids).not.toContain('gpt-5-codex');
    expect(ids).not.toContain('o4-mini');
  });
});
