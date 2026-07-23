import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverMachineSkills,
  normalizeMachineSkillReference,
  readMachineSkill,
  type MachineSkillCatalogOptions
} from './machineCatalog.js';

describe('machine skill catalog', () => {
  let tempRoot: string;
  let options: MachineSkillCatalogOptions;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-machine-skills-'));
    options = {
      codexSkillsRoot: path.join(tempRoot, 'codex-skills'),
      agentsSkillsRoot: path.join(tempRoot, 'agents-skills'),
      pluginCacheRoot: path.join(tempRoot, 'plugin-cache')
    };
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('discovers standard and plugin skills with stable references', async () => {
    const codexSkill = path.join(options.codexSkillsRoot as string, 'playwright');
    const pluginSkill = path.join(
      options.pluginCacheRoot as string,
      'personal',
      'engineering',
      '0.4.0',
      'skills',
      'brainstorm'
    );
    await fs.mkdir(codexSkill, { recursive: true });
    await fs.mkdir(pluginSkill, { recursive: true });
    await fs.writeFile(
      path.join(codexSkill, 'SKILL.md'),
      '---\nname: playwright\ndescription: Browser automation\n---\nUse the browser.'
    );
    await fs.writeFile(
      path.join(pluginSkill, 'SKILL.md'),
      '---\nname: brainstorm\ndescription: Explore options\n---\nCompare approaches.'
    );

    const skills = await discoverMachineSkills(options);

    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference: 'machine://codex/playwright',
        name: 'playwright',
        source: 'codex'
      }),
      expect.objectContaining({
        reference: 'machine://plugin/personal%2Fengineering%2Fbrainstorm',
        name: 'brainstorm',
        sourceLabel: 'Codex Plugin · engineering'
      })
    ]));
  });

  it('loads only the explicitly referenced machine skill', async () => {
    const selectedDir = path.join(options.agentsSkillsRoot as string, 'research', 'arxiv');
    const unselectedDir = path.join(options.agentsSkillsRoot as string, 'research', 'other');
    await fs.mkdir(selectedDir, { recursive: true });
    await fs.mkdir(unselectedDir, { recursive: true });
    await fs.writeFile(path.join(selectedDir, 'SKILL.md'), '# arXiv\nSearch papers.');
    await fs.writeFile(path.join(unselectedDir, 'SKILL.md'), '# Other\nDo something else.');

    const result = await readMachineSkill('machine://agents/research%2Farxiv', options);

    expect(result.skill.name).toBe('arxiv');
    expect(result.content).toContain('Search papers.');
    expect(result.content).not.toContain('Do something else.');
  });

  it('rejects traversal references and symlinks escaping a catalog root', async () => {
    const skillsRoot = options.codexSkillsRoot as string;
    const externalDir = path.join(tempRoot, 'external');
    await fs.mkdir(skillsRoot, { recursive: true });
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, 'SKILL.md'), '# External');
    await fs.symlink(externalDir, path.join(skillsRoot, 'escaped'));

    expect(normalizeMachineSkillReference('machine://codex/..%2Fexternal')).toBeNull();
    expect(await discoverMachineSkills(options)).toEqual([]);
    await expect(readMachineSkill('machine://codex/escaped', options)).rejects.toThrow(/unavailable/i);
  });
});
