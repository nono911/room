import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  loadTaskBoard,
  addTaskCards,
  renderTaskBoardMarkdown,
  updateTaskCardStatus,
  updateTaskCardStatusBestEffort
} from './taskBoard.js';
import { testWorkspace } from '../testWorkspace.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-board-'));
  await fs.mkdir(path.join(dir, '.room'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('loadTaskBoard', () => {
  it('returns an empty board when no file exists', async () => {
    expect(await loadTaskBoard(testWorkspace(dir))).toEqual({ cards: [] });
  });

  it('throws an error when board.json is malformed JSON', async () => {
    const tasksDir = path.join(dir, '.room', 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(path.join(tasksDir, 'board.json'), '{invalid json}');
    await expect(loadTaskBoard(testWorkspace(dir))).rejects.toThrow();
  });
});

describe('addTaskCards', () => {
  it('creates cards with sequential ids and links parents by title', async () => {
    const created = await addTaskCards(testWorkspace(dir), [
      { title: 'Login Epic', kind: 'epic' },
      { title: 'Build form', kind: 'task', parent: 'Login Epic' },
      { title: 'Add validation', kind: 'subtask', parent: 'Build form' }
    ], 'discussion-1');

    expect(created.map(card => card.id)).toEqual(['card-001', 'card-002', 'card-003']);
    expect(created[1].parentId).toBe('card-001');
    expect(created[2].parentId).toBe('card-002');
    expect(created[0].status).toBe('todo');
    expect(created[0].sourceDiscussionId).toBe('discussion-1');

    const board = await loadTaskBoard(testWorkspace(dir));
    expect(board.cards).toHaveLength(3);
  });

  it('continues numbering across canonical board updates', async () => {
    await addTaskCards(testWorkspace(dir), [{ title: 'First' }]);
    const second = await addTaskCards(testWorkspace(dir), [{ title: 'Second' }]);
    expect(second[0].id).toBe('card-002');

    const persisted = JSON.parse(await fs.readFile(
      path.join(dir, '.room', 'tasks', 'board.json'),
      'utf-8'
    ));
    expect(persisted.cards.map((card: { id: string }) => card.id))
      .toEqual(['card-001', 'card-002']);
  });

  it('leaves parentId unset when the parent title does not exist', async () => {
    const created = await addTaskCards(testWorkspace(dir), [{ title: 'Orphan', parent: 'Missing Epic' }]);
    expect(created[0].parentId).toBeUndefined();
  });

  it('preserves concurrent additions without reusing ids', async () => {
    const [first, second] = await Promise.all([
      addTaskCards(testWorkspace(dir), [{ title: 'Concurrent A' }]),
      addTaskCards(testWorkspace(dir), [{ title: 'Concurrent B' }])
    ]);
    expect([first[0].id, second[0].id].sort()).toEqual(['card-001', 'card-002']);
    expect((await loadTaskBoard(testWorkspace(dir))).cards.map(card => card.title).sort())
      .toEqual(['Concurrent A', 'Concurrent B']);
  });

  it('skips creating cards with existing titles (case-insensitive) and does not increment ids for skipped cards', async () => {
    await addTaskCards(testWorkspace(dir), [{ title: 'First Task' }]);
    const added = await addTaskCards(testWorkspace(dir), [
      { title: 'first task' },
      { title: 'Second Task' }
    ]);
    expect(added).toHaveLength(1);
    expect(added[0].title).toBe('Second Task');
    expect(added[0].id).toBe('card-002');

    const board = await loadTaskBoard(testWorkspace(dir));
    expect(board.cards).toHaveLength(2);
    expect(board.cards.map(c => c.title)).toEqual(['First Task', 'Second Task']);
  });
});

describe('updateTaskCardStatus', () => {
  it('resolves false without throwing when the card does not exist', async () => {
    await expect(updateTaskCardStatus(testWorkspace(dir), 'card-missing', 'done'))
      .resolves.toBe(false);
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'throws instead of swallowing a real write failure into an unchecked false',
    async () => {
      await addTaskCards(testWorkspace(dir), [{ title: 'First' }]);
      const tasksDir = path.join(dir, '.room', 'tasks');
      await fs.chmod(tasksDir, 0o500);
      try {
        // Before the fix this resolved `false` — a write failure (e.g. quota
        // exceeded) must surface as a rejection, since no caller checks the
        // boolean return.
        await expect(updateTaskCardStatus(testWorkspace(dir), 'card-001', 'done'))
          .rejects.toThrow();
      } finally {
        await fs.chmod(tasksDir, 0o700);
      }
    }
  );
});

describe('updateTaskCardStatusBestEffort', () => {
  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'swallows a write failure instead of letting it propagate to the caller',
    async () => {
      await addTaskCards(testWorkspace(dir), [{ title: 'First' }]);
      const tasksDir = path.join(dir, '.room', 'tasks');
      await fs.chmod(tasksDir, 0o500);
      try {
        await expect(updateTaskCardStatusBestEffort(
          testWorkspace(dir),
          'card-001',
          'done',
          'done'
        )).resolves.toBeUndefined();
      } finally {
        await fs.chmod(tasksDir, 0o700);
      }
    }
  );
});

describe('renderTaskBoardMarkdown', () => {
  it('renders children indented under parents and orphans at root', () => {
    const markdown = renderTaskBoardMarkdown({
      cards: [
        { id: 'card-001', title: 'Epic', kind: 'epic', status: 'todo', createdAt: 't' },
        { id: 'card-002', title: 'Child', kind: 'task', parentId: 'card-001', status: 'done', createdAt: 't' },
        { id: 'card-003', title: 'Orphan', kind: 'task', parentId: 'card-999', status: 'todo', createdAt: 't' }
      ]
    });
    expect(markdown).toContain('- [ ] **card-001** (epic) Epic');
    expect(markdown).toContain('  - [x] **card-002** (task) Child');
    expect(markdown).toContain('- [ ] **card-003** (task) Orphan');
  });
});
