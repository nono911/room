import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverMachineSkills,
  discoverMachineSkillsWithDiagnostics,
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
    await expect(readMachineSkill(
      'machine://plugin/personal%2Fengineering%2Fbrainstorm',
      options
    )).resolves.toMatchObject({
      content: expect.stringContaining('Compare approaches.')
    });
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

  it('resolves a saved reference without depending on global catalog order', async () => {
    const skillsRoot = options.agentsSkillsRoot as string;
    const selectedDir = path.join(skillsRoot, 'zzz-selected');
    await fs.mkdir(selectedDir, { recursive: true });
    await fs.writeFile(path.join(selectedDir, 'SKILL.md'), '# Selected\nStable instructions.');
    await Promise.all(Array.from({ length: 1_005 }, async (_, index) => {
      const directory = path.join(skillsRoot, `unrelated-${index}`);
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'SKILL.md'), `# Unrelated ${index}`);
    }));

    await expect(readMachineSkill('machine://agents/zzz-selected', options))
      .resolves.toMatchObject({
        skill: { reference: 'machine://agents/zzz-selected' },
        content: expect.stringContaining('Stable instructions.')
      });
  });

  it('selects plugin version metadata before reading only the winning skill', async () => {
    const pluginRoot = options.pluginCacheRoot as string;
    const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
    await Promise.all(Array.from({ length: 64 }, async (_, index) => {
      const skillDir = path.join(
        pluginRoot,
        'personal',
        'engineering',
        `0.0.${index}`,
        'skills',
        'quality'
      );
      await fs.mkdir(skillDir, { recursive: true });
      const skillFile = path.join(skillDir, 'SKILL.md');
      await fs.writeFile(skillFile, `# Old version ${index}\n${'x'.repeat(128 * 1024)}`);
      await fs.utimes(skillFile, oldTimestamp, oldTimestamp);
    }));
    const selectedDir = path.join(
      pluginRoot,
      'personal',
      'engineering',
      '9.9.9',
      'skills',
      'quality'
    );
    await fs.mkdir(selectedDir, { recursive: true });
    await fs.writeFile(
      path.join(selectedDir, 'SKILL.md'),
      '---\nname: quality\n---\nSelected bounded version.'
    );

    await expect(readMachineSkill(
      'machine://plugin/personal%2Fengineering%2Fquality',
      options
    )).resolves.toMatchObject({
      content: expect.stringContaining('Selected bounded version.'),
      skill: { relativePath: expect.stringContaining('9.9.9/skills/quality') }
    });
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

  it('bounds catalog metadata and the number of discovered skill files', async () => {
    const skillsRoot = options.codexSkillsRoot as string;
    await fs.mkdir(skillsRoot, { recursive: true });
    for (let offset = 0; offset < 1_005; offset += 50) {
      await Promise.all(Array.from(
        { length: Math.min(50, 1_005 - offset) },
        async (_, index) => {
          const skillIndex = offset + index;
          const skillDir = path.join(skillsRoot, `skill-${skillIndex}`);
          await fs.mkdir(skillDir);
          await fs.writeFile(
            path.join(skillDir, 'SKILL.md'),
            `---\nname: skill-${skillIndex}\ndescription: ${'d'.repeat(3_000)}\n---\nUse it.`
          );
        }
      ));
    }

    const { skills, truncated } = await discoverMachineSkillsWithDiagnostics(options);

    expect(skills.length).toBeLessThanOrEqual(1_000);
    expect(skills.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(skills[0].description || '', 'utf-8')).toBeLessThanOrEqual(2_048);
    expect(truncated).toBe(true);
  });
});
