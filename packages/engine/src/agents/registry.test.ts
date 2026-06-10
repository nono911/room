import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from './registry.js';

const base = { name: 'Architect', role: 'Architecture', systemPrompt: 'You design systems.' };

describe('validateAgentConfig provider handling', () => {
  it('normalizes legacy provider names to registry ids', () => {
    for (const [legacy, id] of [['Gemini', 'gemini'], ['Claude', 'anthropic'], ['Codex', 'openai']] as const) {
      const result = validateAgentConfig({ ...base, provider: legacy });
      expect(result.success).toBe(true);
      if (result.success) expect(result.agent.provider).toBe(id);
    }
  });

  it('accepts custom provider slugs', () => {
    const result = validateAgentConfig({ ...base, provider: 'groq' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.agent.provider).toBe('groq');
  });

  it('keeps Local CLI unchanged', () => {
    const result = validateAgentConfig({ ...base, provider: 'Local CLI', cliPreset: 'claude' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.agent.provider).toBe('Local CLI');
  });

  it('rejects invalid provider strings', () => {
    for (const bad of ['', 'My Proxy', '-bad', 'UPPER']) {
      const result = validateAgentConfig({ ...base, provider: bad });
      expect(result.success).toBe(false);
    }
  });
});
