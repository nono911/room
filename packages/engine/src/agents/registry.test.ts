import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { loadAgents, saveAgent, validateAgentConfig } from './registry.js';

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

describe('member id handling', () => {
  const base = {
    name: 'UX Researcher',
    role: 'UX',
    provider: 'gemini',
    systemPrompt: 'Research interface needs.'
  };

  it('preserves valid stable member IDs', () => {
    const result = validateAgentConfig({ ...base, id: 'mem_ux_researcher_ab12cd' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.agent.id).toBe('mem_ux_researcher_ab12cd');
    }
  });

  it('rejects malformed stable member IDs', () => {
    const result = validateAgentConfig({ ...base, id: '../bad' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/member id/i);
    }
  });

  it('round-trips persisted stable IDs through loadAgents', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-id-'));
    await fs.mkdir(path.join(dir, '.room', 'members'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.room', 'members', 'mem_ux_researcher_ab12cd.json'),
      JSON.stringify({ ...base, id: 'mem_ux_researcher_ab12cd' }, null, 2),
      'utf-8'
    );

    const agents = await loadAgents(dir);
    const agent = agents.find(item => item.name === 'UX Researcher');
    expect(agent?.id).toBe('mem_ux_researcher_ab12cd');
  });

  it('uses ID-based filenames when saving ID-backed members', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-save-'));
    await saveAgent(dir, { ...base, id: 'mem_ux_researcher_ab12cd' });
    const saved = await fs.readFile(path.join(dir, '.room', 'members', 'mem_ux_researcher_ab12cd.json'), 'utf-8');
    expect(JSON.parse(saved).id).toBe('mem_ux_researcher_ab12cd');
  });
});
