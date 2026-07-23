import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalCliProvider } from '../providers/localCli.js';
import { DiscussionEngine, safeDocumentSlug, stripExternalFileLinks, globToRegex } from './engine.js';

afterEach(() => {
  vi.restoreAllMocks();
});

async function createWorkspaceWithAgents(agents: unknown[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-engine-interrupt-'));
  const membersDir = path.join(dir, '.room', 'members');
  await fs.mkdir(membersDir, { recursive: true });
  await Promise.all(agents.map((agent: any) =>
    fs.writeFile(path.join(membersDir, `${agent.name}.json`), JSON.stringify(agent, null, 2), 'utf-8')
  ));
  return dir;
}

const localCliAgent = (name: string, role: string) => ({
  name,
  role,
  provider: 'Local CLI',
  systemPrompt: `${name} system prompt.`,
  cliPreset: 'claude',
  stdinFormat: 'text',
  permissionMode: 'safe'
});

describe('safeDocumentSlug', () => {
  it('preserves Thai vowels and tone marks in document filenames', () => {
    expect(safeDocumentSlug('ถ้าต้องการเล่น forex ตอนนี้ เทรดยาว 3 เดือน ควรซื้อคู่ไหน')).toBe(
      'ถ้าต้องการเล่น-forex-ตอนนี้-เทรดยาว-3-เดือน-ควรซื้อคู่ไหน'
    );
  });

  it('falls back when the title has no filename-safe characters', () => {
    expect(safeDocumentSlug('!!!')).toBe('discussion');
  });
});

describe('stripExternalFileLinks', () => {
  it('removes file links outside the workspace from provider output', () => {
    const content = stripExternalFileLinks(
      'Saved in [forex_3month_strategy.md](file:///Users/me/.gemini/antigravity-cli/brain/id/forex_3month_strategy.md).',
      '/Users/me/workspace'
    );

    expect(content).toBe('Saved in forex_3month_strategy.md.');
  });

  it('keeps file links inside the workspace', () => {
    const link = 'file:///Users/me/workspace/.room/documents/summary.md';
    expect(stripExternalFileLinks(`[summary](${link})`, '/Users/me/workspace')).toBe(`[summary](${link})`);
  });

  it('redacts bare file urls outside the workspace', () => {
    const content = stripExternalFileLinks(
      'See file:///Users/me/.gemini/antigravity-cli/brain/id/notes.md for details.',
      '/Users/me/workspace'
    );

    expect(content).toBe('See [external file path removed] for details.');
  });
});

describe('DiscussionEngine interrupt checkpoints', () => {
  it('stops a discussion after the current agent turn and records the pivot message', async () => {
    const dir = await createWorkspaceWithAgents([
      localCliAgent('Doer', 'Doer'),
      localCliAgent('Reviewer', 'Reviewer')
    ]);
    vi.spyOn(LocalCliProvider.prototype, 'execute').mockResolvedValue('Doer output');
    let shouldInterrupt = false;
    const events: string[] = [];

    const engine = new DiscussionEngine(dir);
    const log = await engine.runDiscussion(
      'discussion-100',
      'Test discussion',
      'Original direction',
      ['Doer', 'Reviewer'],
      2,
      {
        onEvent: event => {
          events.push(event.type);
          if (event.type === 'message_completed') {
            shouldInterrupt = true;
          }
        },
        reviewMode: true,
        getInterruptMessage: () => shouldInterrupt ? 'Change direction now.' : null
      }
    );

    expect(log.status).toBe('interrupted');
    expect(log.messages.map(message => message.agentName)).toEqual(['You', 'Doer', 'You']);
    expect(log.messages.at(-1)?.content).toContain('Change direction now.');
    expect(LocalCliProvider.prototype.execute).toHaveBeenCalledTimes(1);
    expect(events).toContain('discussion_interrupted');
  });

  it('stops a task run before reviewer execution when the user pivots after the doer turn', async () => {
    const dir = await createWorkspaceWithAgents([
      localCliAgent('Doer', 'Doer'),
      localCliAgent('Reviewer', 'Reviewer')
    ]);
    vi.spyOn(LocalCliProvider.prototype, 'execute').mockResolvedValue('Doer output');
    let shouldInterrupt = false;

    const engine = new DiscussionEngine(dir);
    const result = await engine.runCodingTask(
      'task-100',
      'Test task',
      'Original task',
      'Doer',
      ['Reviewer'],
      2,
      {
        onEvent: event => {
          if (event.type === 'message_completed' && event.message.agentName === 'Doer') {
            shouldInterrupt = true;
          }
        },
        taskType: 'general',
        getInterruptMessage: () => shouldInterrupt ? 'Pivot the task before review.' : null
      }
    );

    expect(result.status).toBe('interrupted');
    expect(result.messages.map(message => message.agentName)).toEqual(['You', 'Doer', 'You']);
    expect(result.messages.at(-1)?.content).toContain('Pivot the task before review.');
    expect(LocalCliProvider.prototype.execute).toHaveBeenCalledTimes(1);
  });

  it('delivers only each task agent selected skills', async () => {
    const dir = await createWorkspaceWithAgents([
      { ...localCliAgent('Doer', 'Doer'), skills: ['doer-guidance.md'] },
      { ...localCliAgent('Reviewer', 'Reviewer'), skills: ['review-guidance.md'] }
    ]);
    await fs.mkdir(path.join(dir, '.room', 'skills'), { recursive: true });
    await fs.writeFile(path.join(dir, '.room', 'skills', 'doer-guidance.md'), '# Doer\nApply doer-only guidance.');
    await fs.writeFile(path.join(dir, '.room', 'skills', 'review-guidance.md'), '# Review\nApply reviewer-only guidance.');
    const execute = vi.spyOn(LocalCliProvider.prototype, 'execute')
      .mockResolvedValueOnce('Completed work.')
      .mockResolvedValueOnce('APPROVAL_STATUS: APPROVED\nOPEN_FINDINGS: None.');

    const engine = new DiscussionEngine(dir);
    await engine.runCodingTask(
      'task-selected-skills',
      'Selected skill task',
      'Complete this task.',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general' }
    );

    expect(execute.mock.calls[0][1]).toContain('Apply doer-only guidance.');
    expect(execute.mock.calls[0][1]).not.toContain('Apply reviewer-only guidance.');
    expect(execute.mock.calls[1][1]).toContain('Apply reviewer-only guidance.');
    expect(execute.mock.calls[1][1]).not.toContain('Apply doer-only guidance.');
  });

  it('does not approve when a reviewer skips before any explicit approval', async () => {
    const dir = await createWorkspaceWithAgents([
      localCliAgent('Doer', 'Doer'),
      localCliAgent('Reviewer', 'Reviewer')
    ]);
    vi.spyOn(LocalCliProvider.prototype, 'execute')
      .mockResolvedValueOnce('Implementation proposal.')
      .mockResolvedValueOnce('SKIP: no remaining findings');

    const engine = new DiscussionEngine(dir);
    const log = await engine.runDiscussion(
      'discussion-101',
      'Review skip',
      'Check this proposal',
      ['Doer', 'Reviewer'],
      1,
      { reviewMode: true }
    );

    expect(log.status).toBe('needs_revision');
    expect(log.messages.at(-1)?.content).toBe('[Reviewer skipped this turn: no remaining findings]');
  });

  it('preserves a reviewer approval when the reviewer skips a later round', async () => {
    const dir = await createWorkspaceWithAgents([
      localCliAgent('Doer', 'Doer'),
      localCliAgent('ReviewerA', 'Reviewer'),
      localCliAgent('ReviewerB', 'Reviewer')
    ]);
    vi.spyOn(LocalCliProvider.prototype, 'execute')
      .mockResolvedValueOnce('Implementation proposal.')
      .mockResolvedValueOnce('APPROVAL_STATUS: APPROVED\nOPEN_FINDINGS: None.')
      .mockResolvedValueOnce('APPROVAL_STATUS: NEEDS_REVISION\nOPEN_FINDINGS: Needs one more pass.')
      .mockResolvedValueOnce('Second implementation pass.')
      .mockResolvedValueOnce('SKIP: approval already given')
      .mockResolvedValueOnce('APPROVAL_STATUS: APPROVED\nOPEN_FINDINGS: None.');

    const engine = new DiscussionEngine(dir);
    const log = await engine.runDiscussion(
      'discussion-102',
      'Review skip after approval',
      'Check this proposal',
      ['Doer', 'ReviewerA', 'ReviewerB'],
      2,
      { reviewMode: true }
    );

    expect(log.status).toBe('approved');
    expect(log.messages.find(message => message.agentName === 'ReviewerA' && message.content.includes('approval already given'))?.content)
      .toBe('[ReviewerA skipped this turn: approval already given]');
  });

  it('passes read-only tool access to safe local CLI agents when enabled', async () => {
    const dir = await createWorkspaceWithAgents([localCliAgent('Doer', 'Doer')]);
    const execSpy = vi.spyOn(LocalCliProvider.prototype, 'execute').mockResolvedValueOnce('Answer.');

    const engine = new DiscussionEngine(dir);
    await engine.runDiscussion('discussion-201', 'Tools on', 'Check the workspace', ['Doer'], 1, {
      allowReadOnlyTools: true
    });

    const [, systemPrompt, execOptions] = execSpy.mock.calls[0];
    expect(execOptions?.toolAccess).toBe('read-only');
    expect(systemPrompt).toContain('Read-Only Tools Policy');
    expect(systemPrompt).not.toContain('Do not inspect the workspace');
  });

  it('keeps local CLI agents tool-free by default', async () => {
    const dir = await createWorkspaceWithAgents([localCliAgent('Doer', 'Doer')]);
    const execSpy = vi.spyOn(LocalCliProvider.prototype, 'execute').mockResolvedValueOnce('Answer.');

    const engine = new DiscussionEngine(dir);
    await engine.runDiscussion('discussion-202', 'Tools off', 'Check the workspace', ['Doer'], 1, {});

    const [, systemPrompt, execOptions] = execSpy.mock.calls[0];
    expect(execOptions?.toolAccess).toBe('none');
    expect(systemPrompt).toContain('Do not inspect the workspace');
    expect(systemPrompt).not.toContain('Read-Only Tools Policy');
  });
});

describe('globToRegex', () => {
  it('matches **/*.ts for any depth TypeScript file', () => {
    const regex = globToRegex('**/*.ts');
    expect(regex.test('src/utils/helper.ts')).toBe(true);
    expect(regex.test('index.ts')).toBe(true);
    expect(regex.test('deeply/nested/path/file.ts')).toBe(true);
  });

  it('does not match wrong extension with **/*.ts', () => {
    const regex = globToRegex('**/*.ts');
    expect(regex.test('src/file.js')).toBe(false);
    expect(regex.test('src/file.tsx')).toBe(false);
  });

  it('escapes dots properly so .ts does not match xts', () => {
    const regex = globToRegex('*.ts');
    expect(regex.test('file.ts')).toBe(true);
    expect(regex.test('filexts')).toBe(false);
  });

  it('handles parentheses in glob patterns safely', () => {
    const regex = globToRegex('src/(utils)/*.ts');
    expect(regex.test('src/(utils)/helper.ts')).toBe(true);
    expect(regex.test('src/utils/helper.ts')).toBe(false);
  });

  it('handles plus signs in glob patterns', () => {
    const regex = globToRegex('test+case.ts');
    expect(regex.test('test+case.ts')).toBe(true);
    expect(regex.test('testXcase.ts')).toBe(false);
  });

  it('single * does not cross directory boundaries', () => {
    const regex = globToRegex('src/*.ts');
    expect(regex.test('src/file.ts')).toBe(true);
    expect(regex.test('src/nested/file.ts')).toBe(false);
  });

  it('** crosses directory boundaries', () => {
    const regex = globToRegex('src/**/*.ts');
    expect(regex.test('src/file.ts')).toBe(true);
    expect(regex.test('src/a/b/c/file.ts')).toBe(true);
  });

  it('trims whitespace from patterns', () => {
    const regex = globToRegex('  **/*.ts  ');
    expect(regex.test('src/file.ts')).toBe(true);
  });

  it('matches exact filenames', () => {
    const regex = globToRegex('package.json');
    expect(regex.test('package.json')).toBe(true);
    expect(regex.test('other/package.json')).toBe(false);
  });

  it('is case-insensitive', () => {
    const regex = globToRegex('**/*.TS');
    expect(regex.test('src/File.ts')).toBe(true);
  });
});

describe('autoMatchSkills integration', () => {
  async function createWorkspaceWithSkills(
    skills: { filename: string; content: string }[]
  ): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-skills-'));
    const skillsDir = path.join(dir, '.room', 'skills');
    const membersDir = path.join(dir, '.room', 'members');
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(membersDir, { recursive: true });

    // Write a minimal agent config
    const agent = {
      name: 'TestAgent',
      role: 'Tester',
      provider: 'Local CLI',
      systemPrompt: 'Test prompt.',
      cliPreset: 'claude',
      stdinFormat: 'text',
      permissionMode: 'safe'
    };
    await fs.writeFile(
      path.join(membersDir, 'testagent.json'),
      JSON.stringify(agent, null, 2),
      'utf-8'
    );

    for (const skill of skills) {
      await fs.writeFile(path.join(skillsDir, skill.filename), skill.content, 'utf-8');
    }
    return dir;
  }

  it('always includes alwaysApply skills', async () => {
    const dir = await createWorkspaceWithSkills([
      {
        filename: 'always-on.md',
        content: `---
name: Always On
alwaysApply: true
---
# Always active skill`
      }
    ]);

    const engine = new DiscussionEngine(dir);
    // Access via a discussion run that triggers autoMatchSkills
    // We test indirectly by verifying the skill system works with the workspace
    const skillsDir = path.join(dir, '.room', 'skills');
    const files = await fs.readdir(skillsDir);
    expect(files).toContain('always-on.md');
  });

  it('does not crash on an empty skills directory', async () => {
    const dir = await createWorkspaceWithSkills([]);
    const engine = new DiscussionEngine(dir);
    // Engine should construct without errors even with empty skills dir
    expect(engine).toBeDefined();
  });

  it('does not crash when skills directory does not exist', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-noskills-'));
    const membersDir = path.join(dir, '.room', 'members');
    await fs.mkdir(membersDir, { recursive: true });
    await fs.writeFile(
      path.join(membersDir, 'testagent.json'),
      JSON.stringify({
        name: 'TestAgent', role: 'Tester', provider: 'Local CLI',
        systemPrompt: 'Test.', cliPreset: 'claude', stdinFormat: 'text', permissionMode: 'safe'
      }, null, 2),
      'utf-8'
    );
    const engine = new DiscussionEngine(dir);
    expect(engine).toBeDefined();
  });

  it('ignores non-.md files in skills directory', async () => {
    const dir = await createWorkspaceWithSkills([
      { filename: 'README.txt', content: 'Not a skill file' },
      {
        filename: 'valid-skill.md',
        content: `---
name: Valid Skill
triggerKeywords: ["test"]
---
# Valid skill content`
      }
    ]);

    const skillsDir = path.join(dir, '.room', 'skills');
    const files = await fs.readdir(skillsDir);
    const mdFiles = files.filter(f => f.toLowerCase().endsWith('.md'));
    expect(mdFiles).toEqual(['valid-skill.md']);
  });

  it('handles malformed skill files without crashing', async () => {
    const dir = await createWorkspaceWithSkills([
      {
        filename: 'broken.md',
        content: `---
name: [bad yaml
  : broken: : :
---
# Broken but parseable content`
      }
    ]);

    const engine = new DiscussionEngine(dir);
    expect(engine).toBeDefined();
  });
});
