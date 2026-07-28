import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../providers/gemini.js';
import type { WorkspaceLocation } from '../workspace.js';
import { DiscussionEngine } from './engine.js';

const roots: string[] = [];

async function fixture(): Promise<{ first: WorkspaceLocation; second: WorkspaceLocation }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-provenance-'));
  roots.push(root);
  const roomRoot = path.join(root, 'room');
  const firstRoot = path.join(root, 'first');
  const secondRoot = path.join(root, 'second');
  await Promise.all([
    fs.mkdir(path.join(roomRoot, 'members'), { recursive: true }),
    fs.mkdir(firstRoot),
    fs.mkdir(secondRoot)
  ]);
  const agents = [
    {
      name: 'Doer',
      role: 'Doer',
      provider: 'Gemini',
      systemPrompt: 'Do the work.',
    },
    {
      name: 'Reviewer',
      role: 'Reviewer',
      provider: 'Gemini',
      systemPrompt: 'Review the work.',
    }
  ];
  await Promise.all(agents.map(agent =>
    fs.writeFile(
      path.join(roomRoot, 'members', `${agent.name.toLowerCase()}.json`),
      JSON.stringify(agent),
      'utf-8'
    )
  ));
  return {
    first: {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_11111111111111111111111111111111',
      sourceName: 'First',
      sourceRoot: firstRoot
    },
    second: {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_22222222222222222222222222222222',
      sourceName: 'Second',
      sourceRoot: secondRoot
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('run Source provenance', () => {
  it('persists provenance even when the provider run fails', async () => {
    const { first } = await fixture();
    vi.spyOn(GeminiProvider.prototype, 'execute').mockRejectedValue(new Error('provider failed'));

    const result = await new DiscussionEngine(first).runDiscussion(
      'discussion-failure',
      'Failure',
      'Record this attempt',
      ['Doer'],
      1
    );

    expect(result.status).toBe('blocked');
    const persisted = JSON.parse(await fs.readFile(
      path.join(first.roomRoot, 'discussions', 'discussion-failure.json'),
      'utf-8'
    ));
    expect(persisted.sourceProvenance).toMatchObject({
      mode: 'source',
      roomId: 'room_test',
      sourceId: first.sourceId
    });
    expect(JSON.stringify(persisted)).not.toContain(first.sourceRoot);
  });

  it('rejects continuing a discussion under a different Source', async () => {
    const { first, second } = await fixture();
    vi.spyOn(GeminiProvider.prototype, 'execute').mockResolvedValue('Initial response.');
    await new DiscussionEngine(first).runDiscussion(
      'discussion-stable-source',
      'Stable Source',
      'Use the first Source',
      ['Doer'],
      1
    );

    await expect(new DiscussionEngine(second).runDiscussion(
      'discussion-stable-source',
      'Stable Source',
      'Continue',
      ['Doer'],
      1
    )).rejects.toThrow('cannot continue under a different Source');
    await expect(new DiscussionEngine(second).summarizeDiscussion(
      'discussion-stable-source',
      ['Doer']
    )).rejects.toThrow('derived run cannot execute under a different Source');
    await expect(new DiscussionEngine({
      roomId: first.roomId,
      roomRoot: first.roomRoot
    }).summarizeDiscussion(
      'discussion-stable-source',
      ['Doer']
    )).rejects.toThrow('derived run cannot execute under a different Source');
  });

  it('continues under the same Source ID after its directory moves', async () => {
    const { first } = await fixture();
    vi.spyOn(GeminiProvider.prototype, 'execute').mockResolvedValue('Response.');
    await new DiscussionEngine(first).runDiscussion(
      'discussion-moved-source',
      'Moved Source',
      'Start',
      ['Doer'],
      1
    );
    const movedRoot = path.join(path.dirname(first.sourceRoot!), 'moved');
    await fs.rename(first.sourceRoot!, movedRoot);
    const moved = { ...first, sourceName: 'Moved', sourceRoot: movedRoot };

    await expect(new DiscussionEngine(moved).runDiscussion(
      'discussion-moved-source',
      'Moved Source',
      'Continue',
      ['Doer'],
      1,
      { continueExisting: true }
    )).resolves.toMatchObject({
      sourceProvenance: {
        sourceId: first.sourceId
      }
    });
  });

  it('requires explicit continuation for an occupied discussion run ID', async () => {
    const { first } = await fixture();
    vi.spyOn(GeminiProvider.prototype, 'execute').mockResolvedValue('Initial response.');
    await new DiscussionEngine(first).runDiscussion(
      'discussion-occupied',
      'Original discussion',
      'Original request',
      ['Doer'],
      1
    );
    const discussionPath = path.join(
      first.roomRoot,
      'discussions',
      'discussion-occupied.json'
    );
    const before = await fs.readFile(discussionPath, 'utf-8');

    await expect(new DiscussionEngine(first).runDiscussion(
      'discussion-occupied',
      'Replacement discussion',
      'Replacement request',
      ['Doer'],
      1
    )).rejects.toThrow('already exists');
    expect(await fs.readFile(discussionPath, 'utf-8')).toBe(before);

    await expect(new DiscussionEngine(first).runDiscussion(
      'discussion-missing',
      'Missing discussion',
      'Continue',
      ['Doer'],
      1,
      { continueExisting: true }
    )).rejects.toThrow('does not exist');
  });

  it('rejects continuing a task under a different Source', async () => {
    const { first, second } = await fixture();
    vi.spyOn(GeminiProvider.prototype, 'execute')
      .mockResolvedValueOnce('Completed.')
      .mockResolvedValueOnce('APPROVAL_STATUS: APPROVED\nOPEN_FINDINGS: None.');
    await new DiscussionEngine(first).runCodingTask(
      'task-stable-source',
      'Stable Source task',
      'Do the task',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general' }
    );

    await expect(new DiscussionEngine(second).runCodingTask(
      'task-stable-source',
      'Stable Source task',
      'Continue',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general' }
    )).rejects.toThrow('cannot continue under a different Source');
  });

  it('rejects an occupied task run ID without replacing its transcript', async () => {
    const { first } = await fixture();
    vi.spyOn(GeminiProvider.prototype, 'execute')
      .mockResolvedValueOnce('Completed.')
      .mockResolvedValueOnce('APPROVAL_STATUS: APPROVED\nOPEN_FINDINGS: None.');
    await new DiscussionEngine(first).runCodingTask(
      'task-occupied',
      'Original task',
      'Original request',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general', associatedCardId: 'card-1' }
    );
    const taskPath = path.join(first.roomRoot, 'tasks', 'task-occupied.json');
    const before = await fs.readFile(taskPath, 'utf-8');

    await expect(new DiscussionEngine(first).runCodingTask(
      'task-occupied',
      'Replacement',
      'Replacement request',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general', associatedCardId: 'card-1' }
    )).rejects.toThrow('already exists');
    expect(await fs.readFile(taskPath, 'utf-8')).toBe(before);
  });

  it('enforces the coding Source capability in the engine after normalization', async () => {
    const { first } = await fixture();
    const roomOnly: WorkspaceLocation = {
      roomId: first.roomId,
      roomRoot: first.roomRoot
    };

    await expect(new DiscussionEngine(roomOnly).runCodingTask(
      'task-source-less-coding',
      'Source-less coding',
      'Change code',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: ' Coding ' }
    )).rejects.toThrow('Attach a Source');
    await expect(fs.access(
      path.join(first.roomRoot, 'tasks', 'task-source-less-coding.json')
    )).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires a real same-Source parent before creating a continued task', async () => {
    const { first, second } = await fixture();
    await fs.mkdir(path.join(first.roomRoot, 'tasks'), { recursive: true });
    await fs.writeFile(
      path.join(first.roomRoot, 'tasks', 'task-parent.json'),
      JSON.stringify({
        id: 'task-parent',
        sourceProvenance: {
          mode: 'source',
          roomId: first.roomId,
          sourceId: first.sourceId,
          sourceName: first.sourceName,
          startedAt: new Date().toISOString()
        }
      }),
      'utf-8'
    );

    await expect(new DiscussionEngine(first).runCodingTask(
      'task-missing-child',
      'Missing parent',
      'Continue',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general', continuedFromTaskId: 'task-does-not-exist' }
    )).rejects.toThrow('does not exist');
    await expect(fs.access(
      path.join(first.roomRoot, 'tasks', 'task-missing-child.json')
    )).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(new DiscussionEngine(second).runCodingTask(
      'task-cross-source-child',
      'Cross Source parent',
      'Continue',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general', continuedFromTaskId: 'task-parent' }
    )).rejects.toThrow('cannot continue under a different Source');
    await expect(fs.access(
      path.join(first.roomRoot, 'tasks', 'task-cross-source-child.json')
    )).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when a persisted discussion or task has no provenance', async () => {
    const { first } = await fixture();
    await Promise.all([
      fs.mkdir(path.join(first.roomRoot, 'discussions'), { recursive: true }),
      fs.mkdir(path.join(first.roomRoot, 'tasks'), { recursive: true })
    ]);
    await fs.writeFile(
      path.join(first.roomRoot, 'discussions', 'discussion-legacy.json'),
      JSON.stringify({
        id: 'discussion-legacy',
        title: 'Legacy',
        topic: 'Legacy',
        status: 'active',
        messages: []
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(first.roomRoot, 'tasks', 'task-legacy-parent.json'),
      JSON.stringify({ id: 'task-legacy-parent' }),
      'utf-8'
    );

    await expect(new DiscussionEngine(first).runDiscussion(
      'discussion-legacy',
      'Legacy',
      'Continue',
      ['Doer'],
      1
    )).rejects.toThrow('no recorded Source provenance');
    await expect(new DiscussionEngine(first).runCodingTask(
      'task-legacy-child',
      'Legacy continuation',
      'Continue',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general', continuedFromTaskId: 'task-legacy-parent' }
    )).rejects.toThrow('no recorded Source provenance');
    await expect(fs.access(
      path.join(first.roomRoot, 'tasks', 'task-legacy-child.json')
    )).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not silently replace unreadable discussion or task artifacts', async () => {
    const { first } = await fixture();
    await Promise.all([
      fs.mkdir(path.join(first.roomRoot, 'discussions'), { recursive: true }),
      fs.mkdir(path.join(first.roomRoot, 'tasks'), { recursive: true })
    ]);
    await fs.writeFile(
      path.join(first.roomRoot, 'discussions', 'discussion-corrupt.json'),
      '{"partial":'
    );
    await fs.writeFile(
      path.join(first.roomRoot, 'tasks', 'task-corrupt.json'),
      '{"partial":'
    );
    await expect(new DiscussionEngine(first).runDiscussion(
      'discussion-corrupt',
      'Corrupt',
      'Continue',
      ['Doer'],
      1
    )).rejects.toThrow();
    await expect(new DiscussionEngine(first).runCodingTask(
      'task-corrupt',
      'Corrupt',
      'Continue',
      'Doer',
      ['Reviewer'],
      1,
      { taskType: 'general' }
    )).rejects.toThrow();
    expect(await fs.readFile(
      path.join(first.roomRoot, 'discussions', 'discussion-corrupt.json'),
      'utf-8'
    )).toBe('{"partial":');
    expect(await fs.readFile(
      path.join(first.roomRoot, 'tasks', 'task-corrupt.json'),
      'utf-8'
    )).toBe('{"partial":');
  });
});
