// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { normalizeTemporaryAgents } from '../../main/ipc/temporary-agents.js';

const base = {
  id: 'tmp_reviewer',
  name: 'Reviewer 1',
  role: 'Review',
  provider: 'Local CLI',
  modelName: 'gpt-5.6-terra',
  systemPrompt: 'Review the work.',
  skills: []
};

describe('temporary Local CLI normalization', () => {
  it('accepts verified presets in safe mode', () => {
    expect(normalizeTemporaryAgents([{
      ...base,
      cliPreset: 'codex',
      stdinFormat: 'text',
      permissionMode: 'safe'
    }])).toEqual([expect.objectContaining({
      id: 'tmp_reviewer',
      provider: 'Local CLI',
      cliPreset: 'codex',
      permissionMode: 'safe'
    })]);
  });

  it('accepts restored presets and rejects unsupported or dangerous mode', () => {
    expect(normalizeTemporaryAgents([
      { ...base, cliPreset: 'gemini', permissionMode: 'safe' }
    ])).toEqual([expect.objectContaining({ cliPreset: 'gemini' })]);
    expect(normalizeTemporaryAgents([
      { ...base, cliPreset: 'copilot', permissionMode: 'safe' },
      { ...base, id: 'tmp_danger', cliPreset: 'codex', permissionMode: 'dangerous' }
    ])).toEqual([]);
  });
});
