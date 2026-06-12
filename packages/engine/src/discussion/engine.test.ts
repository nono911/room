import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalCliProvider } from '../providers/localCli.js';
import { DiscussionEngine, safeDocumentSlug, stripExternalFileLinks } from './engine.js';

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
});
