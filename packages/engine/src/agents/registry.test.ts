import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { loadAgents, saveAgent, validateAgentConfig } from './registry.js';
import { testWorkspace } from '../testWorkspace.js';

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

  it('rejects Local CLI agents at the domain boundary', () => {
    const result = validateAgentConfig({ ...base, provider: 'Local CLI', cliPreset: 'claude' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Local CLI agents are disabled');
  });

  it('rejects invalid provider strings', () => {
    for (const bad of ['', 'My Proxy', '-bad', 'UPPER']) {
      const result = validateAgentConfig({ ...base, provider: bad });
      expect(result.success).toBe(false);
    }
  });
});

describe('member skill references', () => {
  const skillAgent = { ...base, provider: 'gemini' };

  it('keeps workspace filenames and valid machine skill references', () => {
    const result = validateAgentConfig({
      ...skillAgent,
      skills: ['room://skills/api-design.md', 'machine://agents/research%2Farxiv']
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.agent.skills).toEqual([
        'room://skills/api-design.md',
        'machine://agents/research%2Farxiv'
      ]);
    }
  });

  it('rejects unsafe or malformed skill references', () => {
    const result = validateAgentConfig({
      ...skillAgent,
      skills: ['../escape.md', 'machine://codex/..%2Fescape', 'notes.txt']
    });

    expect(result.success).toBe(false);
  });

  it('deduplicates selections and rejects an unbounded skill list', () => {
    const deduped = validateAgentConfig({
      ...skillAgent,
      skills: ['room://skills/api-design.md', 'room://skills/api-design.md']
    });
    expect(deduped.success).toBe(true);
    if (deduped.success) expect(deduped.agent.skills).toEqual(['room://skills/api-design.md']);

    const oversized = validateAgentConfig({
      ...skillAgent,
      skills: Array.from(
        { length: 65 },
        (_, index) => `room://skills/skill-${index}.md`
      )
    });
    expect(oversized.success).toBe(false);
    if (!oversized.success) expect(oversized.error).toContain('at most 64');
  });

  it('rejects oversized persisted member fields', () => {
    const result = validateAgentConfig({
      ...skillAgent,
      systemPrompt: 'x'.repeat(64 * 1024 + 1)
    });
    expect(result.success).toBe(false);
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

    const agents = await loadAgents(testWorkspace(dir));
    const agent = agents.find(item => item.name === 'UX Researcher');
    expect(agent?.id).toBe('mem_ux_researcher_ab12cd');
  });

  it('uses ID-based filenames when saving ID-backed members', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-save-'));
    await saveAgent(testWorkspace(dir), { ...base, id: 'mem_ux_researcher_ab12cd' });
    const saved = await fs.readFile(path.join(dir, '.room', 'members', 'mem_ux_researcher_ab12cd.json'), 'utf-8');
    expect(JSON.parse(saved).id).toBe('mem_ux_researcher_ab12cd');
  });

  it('rejects malformed stable member IDs when saving members', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-save-reject-'));
    await expect(saveAgent(testWorkspace(dir), { ...base, id: '../bad' as unknown as string })).rejects.toThrow(/member id/i);
  });

  it('sanitizes traversal-like member names into safe filenames', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-save-sanitize-'));
    await saveAgent(testWorkspace(dir), { ...base, name: '../escape' });

    const files = await fs.readdir(path.join(dir, '.room', 'members'));
    const filename = `member-${encodeURIComponent('../escape'.toLowerCase())}.json`;
    expect(files).toContain(filename);

    const saved = await fs.readFile(path.join(dir, '.room', 'members', filename), 'utf-8');
    expect(JSON.parse(saved).name).toBe('../escape');
    await expect(fs.access(path.join(dir, '.room', 'escape.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'escape.json'))).rejects.toThrow();
  });

  it('keeps distinct non-ascii member names on separate saved files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-save-nonascii-'));

    await saveAgent(testWorkspace(dir), {
      name: 'ผู้วิจัย',
      role: 'UX',
      provider: 'gemini',
      systemPrompt: 'Research interface needs.'
    });
    await saveAgent(testWorkspace(dir), {
      name: '研究者',
      role: 'UX',
      provider: 'gemini',
      systemPrompt: 'Research interface needs.'
    });

    const files = (await fs.readdir(path.join(dir, '.room', 'members'))).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).not.toBe(files[1]);

    const contents = await Promise.all(
      files.map(async file => JSON.parse(await fs.readFile(path.join(dir, '.room', 'members', file), 'utf-8')) as { name: string })
    );
    expect(contents.map(item => item.name).sort()).toEqual(['ผู้วิจัย', '研究者']);
  });

  it('updates an existing legacy filename instead of forking it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-save-legacy-'));
    await fs.mkdir(path.join(dir, '.room', 'members'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.room', 'members', 'jane doe.json'),
      JSON.stringify({
        name: 'Jane Doe',
        role: 'UX',
        provider: 'gemini',
        systemPrompt: 'Research interface needs.'
      }, null, 2),
      'utf-8'
    );

    await saveAgent(testWorkspace(dir), {
      name: 'Jane Doe',
      role: 'UX',
      provider: 'gemini',
      systemPrompt: 'Research interface needs.'
    });

    const files = (await fs.readdir(path.join(dir, '.room', 'members'))).sort();
    expect(files).toEqual(['jane doe.json']);

    const saved = await fs.readFile(path.join(dir, '.room', 'members', 'jane doe.json'), 'utf-8');
    expect(JSON.parse(saved).name).toBe('Jane Doe');
  });

  it('fails closed when the member directory exceeds its inspection limit', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-listing-cap-'));
    const membersDir = path.join(dir, '.room', 'members');
    await fs.mkdir(membersDir, { recursive: true });
    await Promise.all(Array.from({ length: 1_001 }, (_, index) =>
      fs.writeFile(path.join(membersDir, `.external-${index}`), '', 'utf-8')
    ));

    await expect(loadAgents(testWorkspace(dir))).rejects.toThrow('entry limit');
  });

  it('rejects persisted member counts above the Room capacity', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-member-capacity-'));
    const membersDir = path.join(dir, '.room', 'members');
    await fs.mkdir(membersDir, { recursive: true });
    await Promise.all(Array.from({ length: 129 }, (_, index) =>
      fs.writeFile(
        path.join(membersDir, `mem_member_${index}.json`),
        JSON.stringify({
          ...base,
          id: `mem_member_${index}`,
          name: `Member ${index}`
        }),
        'utf-8'
      )
    ));

    await expect(loadAgents(testWorkspace(dir))).rejects.toThrow('at most 128');
  });
});
