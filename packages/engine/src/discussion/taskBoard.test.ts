import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadTaskBoard, addTaskCards, renderTaskBoardMarkdown } from './taskBoard.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-board-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('loadTaskBoard', () => {
  it('returns an empty board when no file exists', async () => {
    expect(await loadTaskBoard(dir)).toEqual({ cards: [] });
  });
});

describe('addTaskCards', () => {
  it('creates cards with sequential ids and links parents by title', async () => {
    const created = await addTaskCards(dir, [
      { title: 'Login Epic', kind: 'epic' },
      { title: 'Build form', kind: 'task', parent: 'Login Epic' },
      { title: 'Add validation', kind: 'subtask', parent: 'Build form' }
    ], 'discussion-1');

    expect(created.map(card => card.id)).toEqual(['card-001', 'card-002', 'card-003']);
    expect(created[1].parentId).toBe('card-001');
    expect(created[2].parentId).toBe('card-002');
    expect(created[0].status).toBe('todo');
    expect(created[0].sourceDiscussionId).toBe('discussion-1');

    const board = await loadTaskBoard(dir);
    expect(board.cards).toHaveLength(3);
  });

  it('continues numbering across calls and writes board.md', async () => {
    await addTaskCards(dir, [{ title: 'First' }]);
    const second = await addTaskCards(dir, [{ title: 'Second' }]);
    expect(second[0].id).toBe('card-002');

    const markdown = await fs.readFile(path.join(dir, '.room', 'tasks', 'board.md'), 'utf-8');
    expect(markdown).toContain('card-001');
    expect(markdown).toContain('Second');
  });

  it('leaves parentId unset when the parent title does not exist', async () => {
    const created = await addTaskCards(dir, [{ title: 'Orphan', parent: 'Missing Epic' }]);
    expect(created[0].parentId).toBeUndefined();
  });
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
