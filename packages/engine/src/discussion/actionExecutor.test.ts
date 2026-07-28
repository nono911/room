import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { executeModeratorActions } from './actionExecutor.js';
import { loadTaskBoard } from './taskBoard.js';
import { testWorkspace } from '../testWorkspace.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-exec-'));
  await fs.mkdir(path.join(dir, '.room'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('executeModeratorActions', () => {
  it('creates task cards and ADRs and reports them', async () => {
    const result = await executeModeratorActions(testWorkspace(dir), [
      { action: 'create_task', title: 'Epic A', kind: 'epic' },
      { action: 'create_task', title: 'Task A1', kind: 'task', parent: 'Epic A' },
      { action: 'create_adr', title: 'Use SQLite', context: 'ctx', decision: 'dec' }
    ], 'discussion-7');

    expect(result.createdTaskCards).toHaveLength(2);
    expect(result.createdTaskCards[1].parentId).toBe(result.createdTaskCards[0].id);
    expect(result.createdAdrs).toEqual([{ id: 'adr-001', filename: 'ADR-001-use-sqlite.md' }]);
    expect(result.errors).toEqual([]);

    const board = await loadTaskBoard(testWorkspace(dir));
    expect(board.cards.every(card => card.sourceDiscussionId === 'discussion-7')).toBe(true);
  });

  it('returns the last control action', async () => {
    const result = await executeModeratorActions(testWorkspace(dir), [
      { action: 'continue', instructions: 'one more round' },
      { action: 'stop', reason: 'done' }
    ]);
    expect(result.control).toBe('stop');
    expect(result.controlInstructions).toBe('done');
    expect(result.createdTaskCards).toEqual([]);
  });

  it('returns null control when no control actions exist', async () => {
    const result = await executeModeratorActions(testWorkspace(dir), [
      { action: 'create_task', title: 'Solo' }
    ]);
    expect(result.control).toBeNull();
  });
});
