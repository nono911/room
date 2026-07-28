import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { withRoomDataLock } from '../roomHome.js';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';
import { readRoomTextFile, writeRoomTextFile } from '../roomFile.js';

export interface TaskCard {
  id: string;
  title: string;
  kind: 'epic' | 'task' | 'subtask';
  parentId?: string;
  details?: string;
  status: 'todo' | 'in_progress' | 'done';
  sourceDiscussionId?: string;
  createdAt: string;
  assignee?: string;
}

export interface TaskBoard {
  cards: TaskCard[];
}

export interface NewTaskCardInput {
  title: string;
  kind?: 'epic' | 'task' | 'subtask';
  parent?: string;
  details?: string;
  assignee?: string;
}

export async function loadTaskBoard(workspace: WorkspaceInput): Promise<TaskBoard> {
  try {
    const content = await readRoomTextFile(workspace, ['tasks', 'board.json'], 4 * 1024 * 1024);
    const parsed = JSON.parse(content) as TaskBoard;
    return { cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return { cards: [] };
    }
    throw err;
  }
}

export async function addTaskCards(
  workspace: WorkspaceInput,
  inputs: NewTaskCardInput[],
  sourceDiscussionId?: string
): Promise<TaskCard[]> {
  const tasksDir = resolveRoomPath(workspace, 'tasks');
  const roomRoot = resolveRoomPath(workspace);
  return withRoomDataLock(roomRoot, 'task-board', async () => {
    await fs.mkdir(tasksDir, { recursive: true });
    const board = await loadTaskBoard(workspace);
    let nextNum = board.cards.reduce((max, card) => {
      const match = card.id.match(/^card-(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0) + 1;

    const titleToId = new Map(board.cards.map(card => [card.title.normalize('NFC').toLowerCase(), card.id]));
    const created: TaskCard[] = [];
    for (const input of inputs) {
      if (titleToId.has(input.title.normalize('NFC').toLowerCase())) {
        continue;
      }
      const card: TaskCard = {
        id: `card-${String(nextNum++).padStart(3, '0')}`,
        title: input.title,
        kind: input.kind || 'task',
        status: 'todo',
        createdAt: new Date().toISOString()
      };
      if (input.details) card.details = input.details;
      if (input.assignee) card.assignee = input.assignee;
      if (sourceDiscussionId) card.sourceDiscussionId = sourceDiscussionId;
      const parentId = input.parent ? titleToId.get(input.parent.normalize('NFC').toLowerCase()) : undefined;
      if (parentId) card.parentId = parentId;
      titleToId.set(card.title.normalize('NFC').toLowerCase(), card.id);
      board.cards.push(card);
      created.push(card);
    }

    await writeBoardSnapshot(workspace, board);
    return created;
  });
}

async function writeBoardSnapshot(
  workspace: WorkspaceInput,
  board: TaskBoard
): Promise<void> {
  await writeRoomTextFile(
    workspace,
    ['tasks', 'board.json'],
    JSON.stringify(board, null, 2)
  );
}

export function renderTaskBoardMarkdown(board: TaskBoard): string {
  const knownIds = new Set(board.cards.map(card => card.id));
  const childrenOf = new Map<string, TaskCard[]>();
  const roots: TaskCard[] = [];
  for (const card of board.cards) {
    if (card.parentId && knownIds.has(card.parentId)) {
      const list = childrenOf.get(card.parentId) || [];
      list.push(card);
      childrenOf.set(card.parentId, list);
    } else {
      roots.push(card);
    }
  }

  const lines: string[] = ['# Task Board', ''];
  const renderCard = (card: TaskCard, depth: number) => {
    const checkbox = card.status === 'done' ? '[x]' : '[ ]';
    const details = card.details ? ` — ${card.details}` : '';
    const assigneeStr = card.assignee ? ` [assignee: ${card.assignee}]` : '';
    lines.push(`${'  '.repeat(depth)}- ${checkbox} **${card.id}** (${card.kind}) ${card.title}${assigneeStr}${details}`);
    for (const child of childrenOf.get(card.id) || []) {
      renderCard(child, depth + 1);
    }
  };
  for (const root of roots) {
    renderCard(root, 0);
  }
  if (board.cards.length === 0) {
    lines.push('No task cards yet.');
  }
  return lines.join('\n') + '\n';
}

// A card that no longer exists (deleted, or never created) is a legitimate,
// expected outcome and reported as `false`. A write or lock failure is not —
// it must reach the caller as a thrown error rather than collapse into the
// same `false`, which no caller here ever checked.
export async function updateTaskCardStatus(
  workspace: WorkspaceInput,
  cardId: string,
  status: 'todo' | 'in_progress' | 'done'
): Promise<boolean> {
  const roomRoot = resolveRoomPath(workspace);
  return withRoomDataLock(roomRoot, 'task-board', async () => {
    const board = await loadTaskBoard(workspace);
    const card = board.cards.find(c => c.id === cardId);
    if (!card) return false;
    card.status = status;
    await writeBoardSnapshot(workspace, board);
    return true;
  });
}

/**
 * Task/discussion execution treats card status as bookkeeping, not part of
 * the run's own success — a run that already completed (or hasn't started
 * doing real work yet) must not fail because the board couldn't be updated.
 * Failures are logged and swallowed here, at the boundary, instead of inside
 * updateTaskCardStatus itself.
 */
export async function updateTaskCardStatusBestEffort(
  workspace: WorkspaceInput,
  cardId: string,
  status: 'todo' | 'in_progress' | 'done',
  action: string
): Promise<void> {
  try {
    await updateTaskCardStatus(workspace, cardId, status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Discussion Engine] Failed to mark task card ${action}: ${message}`);
  }
}
