# Tier S Core Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three Tier S features from `PROPOSED_FEATURES.md`: (2) Moderator Runtime Actions, (3) Discussion ➔ Tasks, and (1) Discussion Inspector.

**Architecture:** All three features share one mechanism: agents emit fenced, machine-readable blocks (` ```room-action ` / ` ```room-refs `) that the engine parses with pure functions. A new task-board store (`.room/tasks/board.json` + rendered `board.md`) holds Epic→Task→Subtask cards. The engine executes moderator actions (create task cards, create ADRs, continue/stop control); the desktop app surfaces results via existing IPC patterns plus two new handlers.

**Tech Stack:** TypeScript (NodeNext ESM), Electron + React (single `App.tsx`), vitest (new, engine package only), no new runtime dependencies.

---

## Preflight (do this before Task 1)

The working tree already has uncommitted changes in `packages/desktop/renderer/src/App.tsx`, `packages/desktop/renderer/src/styles/index.css`, and `packages/engine/src/discussion/engine.ts` from earlier work. Commit them first as their own commit so each task's commit stays clean:

```bash
git add packages/desktop/renderer/src/App.tsx packages/desktop/renderer/src/styles/index.css packages/engine/src/discussion/engine.ts
git commit -m "feat(desktop): wip ui and engine adjustments before tier-s work"
```

If the user does not want these committed, stop and ask them how to handle the dirty tree.

**Conventions used in every task:**
- Build engine: `rtk npm run build:engine` (from repo root)
- Build desktop: `rtk npm run build:desktop`
- Run engine tests: `rtk npm test -w packages/engine`
- Engine source uses strict TS, ESM with `.js` import extensions, 2-space indent, single quotes, semicolons.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/engine/src/discussion/actions.ts` | Create | `ModeratorAction` types, `parseModeratorActions()`, `stripActionBlocks()` |
| `packages/engine/src/discussion/actions.test.ts` | Create | Parser unit tests |
| `packages/engine/src/discussion/taskBoard.ts` | Create | `TaskCard` type, `loadTaskBoard()`, `addTaskCards()`, `renderTaskBoardMarkdown()` |
| `packages/engine/src/discussion/taskBoard.test.ts` | Create | Board store unit tests (temp dirs) |
| `packages/engine/src/discussion/actionExecutor.ts` | Create | `executeModeratorActions()` — turns parsed actions into board cards / ADRs / control signal |
| `packages/engine/src/discussion/actionExecutor.test.ts` | Create | Executor unit tests (temp dirs) |
| `packages/engine/src/discussion/references.ts` | Create | `parseMessageReferences()` for the Inspector |
| `packages/engine/src/discussion/references.test.ts` | Create | Reference parser unit tests |
| `packages/engine/src/decisions/adr.ts` | Modify | Accept optional `context`/`decision` content |
| `packages/engine/src/decisions/adr.test.ts` | Create | ADR unit tests (temp dirs) |
| `packages/engine/src/discussion/engine.ts` | Modify | Wire actions into `evaluateDiscussion`, add `generateTasksFromDiscussion`, wire reference tracing into `runDiscussion` |
| `packages/engine/src/index.ts` | Modify | Export the new modules |
| `packages/engine/package.json` + `packages/engine/tsconfig.json` | Modify | vitest setup, exclude test files from build |
| `packages/desktop/main/main.ts` | Modify | Return moderator actions from `run-discussion`; add `generate-tasks-from-discussion` and `load-task-board` IPC handlers |
| `packages/desktop/main/preload.js` | Modify | Expose the two new IPC calls |
| `packages/desktop/renderer/src/App.tsx` | Modify | System messages for moderator actions; "Generate Tasks (AI)" button; Task Board panel in Tasks tab; Discussion Inspector panel |

---

### Task 1: Vitest setup in the engine package

**Files:**
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/tsconfig.json`

- [x] **Step 1: Install vitest as an engine dev dependency**

```bash
rtk npm install -w packages/engine -D vitest@^3.2.4
```

Expected: `vitest` appears under `devDependencies` in `packages/engine/package.json` and the root lockfile updates.

- [x] **Step 2: Add the test script**

In `packages/engine/package.json`, change the `scripts` block from:

```json
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w"
  },
```

to:

```json
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "test": "vitest run"
  },
```

- [x] **Step 3: Exclude test files from the tsc build**

In `packages/engine/tsconfig.json`, add an `exclude` array so `.test.ts` files never land in `dist/`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": [
    "src/**/*",
    "bin/**/*"
  ],
  "exclude": [
    "src/**/*.test.ts"
  ]
}
```

- [x] **Step 4: Verify the runner works with no tests yet**

```bash
rtk npx vitest run --passWithNoTests --root packages/engine
```

Expected: exit code 0, "No test files found" notice.

- [x] **Step 5: Verify the engine still builds**

```bash
rtk npm run build:engine
```

Expected: PASS (no output, exit 0).

- [x] **Step 6: Commit**

```bash
git add packages/engine/package.json packages/engine/tsconfig.json package-lock.json
git commit -m "chore(engine): add vitest test runner"
```

---

### Task 2: Moderator action parser (`actions.ts`)

The moderator will emit actions as fenced code blocks labeled `room-action`, each containing one JSON object (or a JSON array of objects). This task builds the parser as pure functions.

**Files:**
- Create: `packages/engine/src/discussion/actions.ts`
- Test: `packages/engine/src/discussion/actions.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/engine/src/discussion/actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseModeratorActions, stripActionBlocks } from './actions.js';

describe('parseModeratorActions', () => {
  it('parses a single create_task block', () => {
    const content = 'Verdict text.\n\n```room-action\n{"action": "create_task", "title": "Build login", "kind": "task"}\n```';
    const result = parseModeratorActions(content);
    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([
      { action: 'create_task', title: 'Build login', kind: 'task', details: undefined, parent: undefined }
    ]);
  });

  it('parses multiple blocks including control actions', () => {
    const content = [
      '```room-action',
      '{"action": "continue", "instructions": "Deepen the risk analysis."}',
      '```',
      'Some prose.',
      '```room-action',
      '{"action": "create_adr", "title": "Use SQLite", "context": "Storage layer", "decision": "Adopt SQLite"}',
      '```'
    ].join('\n');
    const result = parseModeratorActions(content);
    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([
      { action: 'continue', instructions: 'Deepen the risk analysis.' },
      { action: 'create_adr', title: 'Use SQLite', context: 'Storage layer', decision: 'Adopt SQLite' }
    ]);
  });

  it('accepts a JSON array of actions in one block', () => {
    const content = '```room-action\n[{"action": "stop", "reason": "Done"}, {"action": "create_task", "title": "Ship it"}]\n```';
    const result = parseModeratorActions(content);
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toEqual({ action: 'stop', reason: 'Done' });
  });

  it('collects invalid JSON as errors without throwing', () => {
    const content = '```room-action\n{not json}\n```';
    const result = parseModeratorActions(content);
    expect(result.actions).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects create_task without a title', () => {
    const content = '```room-action\n{"action": "create_task"}\n```';
    const result = parseModeratorActions(content);
    expect(result.actions).toEqual([]);
    expect(result.errors[0]).toMatch(/title/);
  });

  it('defaults an unknown kind to task and rejects unknown actions', () => {
    const content = [
      '```room-action',
      '{"action": "create_task", "title": "A", "kind": "story"}',
      '```',
      '```room-action',
      '{"action": "delete_everything"}',
      '```'
    ].join('\n');
    const result = parseModeratorActions(content);
    expect(result.actions).toEqual([
      { action: 'create_task', title: 'A', kind: 'task', details: undefined, parent: undefined }
    ]);
    expect(result.errors).toHaveLength(1);
  });

  it('returns empty results when there are no blocks', () => {
    expect(parseModeratorActions('Just a verdict, no actions.')).toEqual({ actions: [], errors: [] });
  });
});

describe('stripActionBlocks', () => {
  it('removes action blocks and collapses extra blank lines', () => {
    const content = 'Before.\n\n```room-action\n{"action": "stop"}\n```\n\nAfter.';
    expect(stripActionBlocks(content)).toBe('Before.\n\nAfter.');
  });

  it('returns trimmed content unchanged when no blocks exist', () => {
    expect(stripActionBlocks('  Hello.  ')).toBe('Hello.');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
rtk npm test -w packages/engine
```

Expected: FAIL — cannot resolve `./actions.js`.

- [x] **Step 3: Implement `actions.ts`**

Create `packages/engine/src/discussion/actions.ts`:

```ts
export interface ContinueAction {
  action: 'continue';
  instructions?: string;
}

export interface StopAction {
  action: 'stop';
  reason?: string;
}

export interface CreateTaskAction {
  action: 'create_task';
  title: string;
  details?: string;
  kind?: 'epic' | 'task' | 'subtask';
  parent?: string;
}

export interface CreateAdrAction {
  action: 'create_adr';
  title: string;
  context?: string;
  decision?: string;
}

export type ModeratorAction = ContinueAction | StopAction | CreateTaskAction | CreateAdrAction;

export interface ParsedModeratorActions {
  actions: ModeratorAction[];
  errors: string[];
}

const ACTION_BLOCK_PATTERN = /```room-action\s*\n([\s\S]*?)```/g;

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateAction(candidate: any): ModeratorAction | string {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.action !== 'string') {
    return 'room-action block is missing a string "action" field.';
  }
  switch (candidate.action) {
    case 'continue':
      return { action: 'continue', instructions: asOptionalString(candidate.instructions) };
    case 'stop':
      return { action: 'stop', reason: asOptionalString(candidate.reason) };
    case 'create_task': {
      const title = asOptionalString(candidate.title);
      if (!title) return 'create_task action requires a non-empty "title".';
      const kind = candidate.kind === 'epic' || candidate.kind === 'task' || candidate.kind === 'subtask'
        ? candidate.kind
        : 'task';
      return {
        action: 'create_task',
        title,
        details: asOptionalString(candidate.details),
        kind,
        parent: asOptionalString(candidate.parent)
      };
    }
    case 'create_adr': {
      const title = asOptionalString(candidate.title);
      if (!title) return 'create_adr action requires a non-empty "title".';
      return {
        action: 'create_adr',
        title,
        context: asOptionalString(candidate.context),
        decision: asOptionalString(candidate.decision)
      };
    }
    default:
      return `Unknown room-action "${candidate.action}".`;
  }
}

export function parseModeratorActions(content: string): ParsedModeratorActions {
  const actions: ModeratorAction[] = [];
  const errors: string[] = [];
  for (const match of content.matchAll(ACTION_BLOCK_PATTERN)) {
    const raw = match[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      errors.push(`Invalid JSON in room-action block: ${err.message}`);
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const validated = validateAction(candidate);
      if (typeof validated === 'string') {
        errors.push(validated);
      } else {
        actions.push(validated);
      }
    }
  }
  return { actions, errors };
}

export function stripActionBlocks(content: string): string {
  return content.replace(ACTION_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
rtk npm test -w packages/engine
```

Expected: PASS (9 tests).

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/discussion/actions.ts packages/engine/src/discussion/actions.test.ts
git commit -m "feat(engine): add moderator runtime action parser"
```

---

### Task 3: Task board store (`taskBoard.ts`)

A single JSON store at `.room/tasks/board.json` holds Epic→Task→Subtask cards, plus a rendered `board.md` so the existing Tasks tab (which lists files in `.room/tasks/`) can already preview it with zero UI changes.

**Files:**
- Create: `packages/engine/src/discussion/taskBoard.ts`
- Test: `packages/engine/src/discussion/taskBoard.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/engine/src/discussion/taskBoard.test.ts`:

```ts
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
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
rtk npm test -w packages/engine
```

Expected: FAIL — cannot resolve `./taskBoard.js`.

- [x] **Step 3: Implement `taskBoard.ts`**

Create `packages/engine/src/discussion/taskBoard.ts`:

```ts
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TaskCard {
  id: string;
  title: string;
  kind: 'epic' | 'task' | 'subtask';
  parentId?: string;
  details?: string;
  status: 'todo' | 'in_progress' | 'done';
  sourceDiscussionId?: string;
  createdAt: string;
}

export interface TaskBoard {
  cards: TaskCard[];
}

export interface NewTaskCardInput {
  title: string;
  kind?: 'epic' | 'task' | 'subtask';
  parent?: string;
  details?: string;
}

function boardPaths(dirPath: string) {
  const tasksDir = path.join(dirPath, '.room', 'tasks');
  return {
    tasksDir,
    jsonPath: path.join(tasksDir, 'board.json'),
    markdownPath: path.join(tasksDir, 'board.md')
  };
}

export async function loadTaskBoard(dirPath: string): Promise<TaskBoard> {
  try {
    const parsed = JSON.parse(await fs.readFile(boardPaths(dirPath).jsonPath, 'utf-8')) as TaskBoard;
    return { cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
  } catch {
    return { cards: [] };
  }
}

export async function addTaskCards(
  dirPath: string,
  inputs: NewTaskCardInput[],
  sourceDiscussionId?: string
): Promise<TaskCard[]> {
  const { tasksDir, jsonPath, markdownPath } = boardPaths(dirPath);
  await fs.mkdir(tasksDir, { recursive: true });
  const board = await loadTaskBoard(dirPath);
  let nextNum = board.cards.reduce((max, card) => {
    const match = card.id.match(/^card-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0) + 1;

  const titleToId = new Map(board.cards.map(card => [card.title.toLowerCase(), card.id]));
  const created: TaskCard[] = [];
  for (const input of inputs) {
    const card: TaskCard = {
      id: `card-${String(nextNum++).padStart(3, '0')}`,
      title: input.title,
      kind: input.kind || 'task',
      status: 'todo',
      createdAt: new Date().toISOString()
    };
    if (input.details) card.details = input.details;
    if (sourceDiscussionId) card.sourceDiscussionId = sourceDiscussionId;
    const parentId = input.parent ? titleToId.get(input.parent.toLowerCase()) : undefined;
    if (parentId) card.parentId = parentId;
    titleToId.set(card.title.toLowerCase(), card.id);
    board.cards.push(card);
    created.push(card);
  }

  await fs.writeFile(jsonPath, JSON.stringify(board, null, 2), 'utf-8');
  await fs.writeFile(markdownPath, renderTaskBoardMarkdown(board), 'utf-8');
  return created;
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
    lines.push(`${'  '.repeat(depth)}- ${checkbox} **${card.id}** (${card.kind}) ${card.title}${details}`);
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
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
rtk npm test -w packages/engine
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/discussion/taskBoard.ts packages/engine/src/discussion/taskBoard.test.ts
git commit -m "feat(engine): add hierarchical task board store"
```

---

### Task 4: ADR creation with content (`adr.ts`)

`createNewADR` currently writes a fixed template. Extend it so moderator actions can fill in real context and decision text. The change is backward compatible — the existing call sites pass no options.

**Files:**
- Modify: `packages/engine/src/decisions/adr.ts`
- Test: `packages/engine/src/decisions/adr.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/engine/src/decisions/adr.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createNewADR } from './adr.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-adr-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createNewADR', () => {
  it('numbers ADRs sequentially', async () => {
    const first = await createNewADR(dir, 'Use SQLite');
    const second = await createNewADR(dir, 'Adopt ESM');
    expect(first).toBe('ADR-001-use-sqlite.md');
    expect(second).toBe('ADR-002-adopt-esm.md');
  });

  it('fills in provided context and decision text', async () => {
    const filename = await createNewADR(dir, 'Use SQLite', {
      context: 'We need embedded storage.',
      decision: 'Adopt SQLite for the local store.'
    });
    const content = await fs.readFile(path.join(dir, '.room', 'decisions', filename), 'utf-8');
    expect(content).toContain('We need embedded storage.');
    expect(content).toContain('Adopt SQLite for the local store.');
    expect(content).not.toContain('Define the architectural challenge');
  });

  it('keeps template placeholders when no options are given', async () => {
    const filename = await createNewADR(dir, 'Use SQLite');
    const content = await fs.readFile(path.join(dir, '.room', 'decisions', filename), 'utf-8');
    expect(content).toContain('Define the architectural challenge and context.');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
rtk npm test -w packages/engine
```

Expected: FAIL — the second test fails its `toContain('We need embedded storage.')` assertion because the current implementation ignores the third argument (vitest strips types, so the extra argument does not error at runtime).

- [x] **Step 3: Modify `adr.ts`**

In `packages/engine/src/decisions/adr.ts`, change the function signature and the two template sections. Replace:

```ts
export async function createNewADR(dirPath: string, title: string): Promise<string> {
```

with:

```ts
export interface AdrContentOptions {
  context?: string;
  decision?: string;
}

export async function createNewADR(
  dirPath: string,
  title: string,
  options: AdrContentOptions = {}
): Promise<string> {
```

Then in the `adrContent` template literal, replace the line:

```
Define the architectural challenge and context.
```

with:

```
${options.context || 'Define the architectural challenge and context.'}
```

and replace the line:

```
Chosen Option: Option X, because ...
```

with:

```
${options.decision || 'Chosen Option: Option X, because ...'}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
rtk npm test -w packages/engine
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/decisions/adr.ts packages/engine/src/decisions/adr.test.ts
git commit -m "feat(engine): support context and decision content in createNewADR"
```

---

### Task 5: Action executor (`actionExecutor.ts`)

Turns a list of parsed `ModeratorAction`s into real side effects: task cards on the board, ADR files, and a continue/stop control signal. Errors are collected, never thrown, so one bad action cannot break a discussion run.

**Files:**
- Create: `packages/engine/src/discussion/actionExecutor.ts`
- Test: `packages/engine/src/discussion/actionExecutor.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/engine/src/discussion/actionExecutor.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { executeModeratorActions } from './actionExecutor.js';
import { loadTaskBoard } from './taskBoard.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-exec-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('executeModeratorActions', () => {
  it('creates task cards and ADRs and reports them', async () => {
    const result = await executeModeratorActions(dir, [
      { action: 'create_task', title: 'Epic A', kind: 'epic' },
      { action: 'create_task', title: 'Task A1', kind: 'task', parent: 'Epic A' },
      { action: 'create_adr', title: 'Use SQLite', context: 'ctx', decision: 'dec' }
    ], 'discussion-7');

    expect(result.createdTaskCards).toHaveLength(2);
    expect(result.createdTaskCards[1].parentId).toBe(result.createdTaskCards[0].id);
    expect(result.createdAdrFilenames).toEqual(['ADR-001-use-sqlite.md']);
    expect(result.errors).toEqual([]);

    const board = await loadTaskBoard(dir);
    expect(board.cards.every(card => card.sourceDiscussionId === 'discussion-7')).toBe(true);
  });

  it('returns the last control action', async () => {
    const result = await executeModeratorActions(dir, [
      { action: 'continue', instructions: 'one more round' },
      { action: 'stop', reason: 'done' }
    ]);
    expect(result.control).toBe('stop');
    expect(result.controlInstructions).toBe('done');
    expect(result.createdTaskCards).toEqual([]);
  });

  it('returns null control when no control actions exist', async () => {
    const result = await executeModeratorActions(dir, [
      { action: 'create_task', title: 'Solo' }
    ]);
    expect(result.control).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
rtk npm test -w packages/engine
```

Expected: FAIL — cannot resolve `./actionExecutor.js`.

- [x] **Step 3: Implement `actionExecutor.ts`**

Create `packages/engine/src/discussion/actionExecutor.ts`:

```ts
import { ModeratorAction, CreateTaskAction } from './actions.js';
import { addTaskCards, TaskCard } from './taskBoard.js';
import { createNewADR } from '../decisions/adr.js';

export interface ActionExecutionResult {
  control: 'continue' | 'stop' | null;
  controlInstructions?: string;
  createdTaskCards: TaskCard[];
  createdAdrFilenames: string[];
  errors: string[];
}

export async function executeModeratorActions(
  dirPath: string,
  actions: ModeratorAction[],
  sourceDiscussionId?: string
): Promise<ActionExecutionResult> {
  const result: ActionExecutionResult = {
    control: null,
    createdTaskCards: [],
    createdAdrFilenames: [],
    errors: []
  };

  for (const action of actions) {
    if (action.action === 'continue') {
      result.control = 'continue';
      result.controlInstructions = action.instructions;
    } else if (action.action === 'stop') {
      result.control = 'stop';
      result.controlInstructions = action.reason;
    }
  }

  const taskActions = actions.filter((action): action is CreateTaskAction => action.action === 'create_task');
  if (taskActions.length > 0) {
    try {
      result.createdTaskCards = await addTaskCards(
        dirPath,
        taskActions.map(action => ({
          title: action.title,
          kind: action.kind,
          parent: action.parent,
          details: action.details
        })),
        sourceDiscussionId
      );
    } catch (err: any) {
      result.errors.push(`create_task failed: ${err.message}`);
    }
  }

  for (const action of actions) {
    if (action.action !== 'create_adr') continue;
    try {
      result.createdAdrFilenames.push(
        await createNewADR(dirPath, action.title, { context: action.context, decision: action.decision })
      );
    } catch (err: any) {
      result.errors.push(`create_adr "${action.title}" failed: ${err.message}`);
    }
  }

  return result;
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
rtk npm test -w packages/engine
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/discussion/actionExecutor.ts packages/engine/src/discussion/actionExecutor.test.ts
git commit -m "feat(engine): add moderator action executor"
```

---

### Task 6: Wire runtime actions into the quality gate (`engine.ts`)

`evaluateDiscussion` (the quality gate) is where the moderator already runs. Teach it to (a) invite the moderator to emit `room-action` blocks, (b) execute them, (c) let `continue`/`stop` override the STATUS verdict, and (d) keep the chat log clean of raw blocks.

**Files:**
- Modify: `packages/engine/src/discussion/engine.ts` (imports at top; `QualityGateResult` near line 84; `evaluateDiscussion` near lines 506–584)
- Modify: `packages/engine/src/index.ts`

- [x] **Step 1: Add imports and extend `QualityGateResult`**

In `packages/engine/src/discussion/engine.ts`, after the existing import of `Provider` (line 9), add:

```ts
import { parseModeratorActions, stripActionBlocks } from './actions.js';
import { executeModeratorActions, ActionExecutionResult } from './actionExecutor.js';
import { TaskCard } from './taskBoard.js';
```

Change the `QualityGateResult` interface from:

```ts
export interface QualityGateResult {
  status: 'PASS' | 'NEEDS_MORE_DISCUSSION';
  content: string;
  nextRoundInstructions: string;
}
```

to:

```ts
export interface QualityGateResult {
  status: 'PASS' | 'NEEDS_MORE_DISCUSSION';
  content: string;
  nextRoundInstructions: string;
  executed?: ActionExecutionResult;
}
```

- [x] **Step 2: Extract a `pickModerator` helper**

In `evaluateDiscussion`, the moderator-selection expression (currently inline) will also be needed by Task 8. Add this private method to `DiscussionEngine` (place it right above `evaluateDiscussion`):

```ts
  private pickModerator(agents: AgentConfig[], moderatorName?: string): AgentConfig | undefined {
    return (
      moderatorName
        ? agents.find(agent => agent.name.toLowerCase() === moderatorName.toLowerCase())
        : undefined
    ) || agents.find(agent => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return text.includes('moderator') || text.includes('lead') || text.includes('director') || text.includes('reviewer');
    }) || agents[0];
  }
```

Then in `evaluateDiscussion`, replace the inline expression:

```ts
    const moderator = (
      moderatorName
        ? agents.find(agent => agent.name.toLowerCase() === moderatorName.toLowerCase())
        : undefined
    ) || agents.find(agent => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return text.includes('moderator') || text.includes('lead') || text.includes('director') || text.includes('reviewer');
    }) || agents[0];
```

with:

```ts
    const moderator = this.pickModerator(agents, moderatorName);
```

- [x] **Step 3: Extend the quality gate prompt**

In `evaluateDiscussion`, the prompt currently ends its instruction section with the `Rules:` list followed by `Chat transcript:`. Insert a new section between the `Rules:` list and `Chat transcript:`:

```
Runtime actions (optional):
You may also emit runtime actions for the ROOM engine to execute. Put each action in its own fenced code block labeled room-action containing one JSON object:
- {"action": "continue", "instructions": "<what the next round must fix>"} - force one more focused round.
- {"action": "stop", "reason": "<why the chat is done>"} - stop the discussion now.
- {"action": "create_task", "title": "...", "details": "...", "kind": "epic|task|subtask", "parent": "<parent card title>"} - add a card to the project task board.
- {"action": "create_adr", "title": "...", "context": "...", "decision": "..."} - record an architecture decision the chat clearly made.
Only emit create_task or create_adr for outcomes the chat actually agreed on. The STATUS line is still required.
```

(Keep it inside the same template literal as the rest of the prompt.)

- [x] **Step 4: Parse and execute actions after the moderator responds**

In `evaluateDiscussion`, replace:

```ts
    const content = await provider.execute(prompt, systemPrompt);
    const result = this.parseQualityGateResult(content);
```

with:

```ts
    const content = await provider.execute(prompt, systemPrompt);
    const { actions, errors: actionErrors } = parseModeratorActions(content);
    const executed = await executeModeratorActions(this.dirPath, actions, discussionId);
    executed.errors.push(...actionErrors);

    const strippedContent = stripActionBlocks(content);
    const result = this.parseQualityGateResult(strippedContent || content);
    if (executed.control === 'stop') {
      result.status = 'PASS';
    } else if (executed.control === 'continue') {
      result.status = 'NEEDS_MORE_DISCUSSION';
      if (executed.controlInstructions) {
        result.nextRoundInstructions = executed.controlInstructions;
      }
    }
    result.executed = executed;

    const actionNotes = [
      ...executed.createdTaskCards.map(card => `[Moderator action: created task card ${card.id} - ${card.title}]`),
      ...executed.createdAdrFilenames.map(filename => `[Moderator action: created ${filename}]`),
      ...executed.errors.map(message => `[Moderator action error: ${message}]`)
    ].join('\n');
    const displayContent = [strippedContent || content.trim(), actionNotes].filter(Boolean).join('\n\n');
```

Then, a few lines below, in the `discussionLog.messages.push({...})` call, change `content,` to `content: displayContent,` so the saved chat shows clean text plus human-readable action notes instead of raw JSON blocks.

- [x] **Step 5: Export the new modules**

In `packages/engine/src/index.ts`, after the line `export * from './discussion/engine.js';` add:

```ts
export * from './discussion/actions.js';
export * from './discussion/actionExecutor.js';
export * from './discussion/taskBoard.js';
```

- [x] **Step 6: Build and run all tests**

```bash
rtk npm run build:engine
rtk npm test -w packages/engine
```

Expected: both PASS.

- [x] **Step 7: Commit**

```bash
git add packages/engine/src/discussion/engine.ts packages/engine/src/index.ts
git commit -m "feat(engine): execute moderator runtime actions in the quality gate"
```

---

### Task 7: Surface moderator actions in the desktop app

`run-discussion` already runs the quality gate. Collect what the moderator's actions created and return it to the renderer, which shows system messages like "Moderator created task card card-003: ...".

**Files:**
- Modify: `packages/desktop/main/main.ts` (handler `run-discussion`, lines ~1194–1244)
- Modify: `packages/desktop/renderer/src/App.tsx` (ElectronAPI type ~line 95; `handleSendDiscussion` ~lines 2789–2811)

- [x] **Step 1: Collect actions in the `run-discussion` handler**

In `packages/desktop/main/main.ts`, inside the `run-discussion` handler, find the `if (qualityGate) {` block. Immediately before it (after the first `runDiscussion` call), add:

```ts
    const moderatorActions: Array<{ type: 'task' | 'adr'; id?: string; title?: string; filename?: string }> = [];
```

Inside the quality-gate loop, change:

```ts
        const verdict = await engine.evaluateDiscussion(discussionId, moderatorName);
```

to:

```ts
        const verdict = await engine.evaluateDiscussion(discussionId, moderatorName);
        if (verdict.executed) {
          moderatorActions.push(
            ...verdict.executed.createdTaskCards.map(card => ({ type: 'task' as const, id: card.id, title: card.title })),
            ...verdict.executed.createdAdrFilenames.map(filename => ({ type: 'adr' as const, filename }))
          );
        }
```

And change the success return at the end of the handler from:

```ts
    return { success: true, log, summary };
```

to:

```ts
    return { success: true, log, summary, moderatorActions };
```

- [x] **Step 2: Extend the renderer types**

In `packages/desktop/renderer/src/App.tsx`, in the `runDiscussion` return type (the object containing `success`, `summary?`, `log?`, `error?` around line 95), add one field alongside `summary?`:

```ts
        moderatorActions?: { type: 'task' | 'adr'; id?: string; title?: string; filename?: string }[];
```

- [x] **Step 3: Show system messages for executed actions**

In `handleSendDiscussion` (around line 2802), the success branch currently builds `statusMessage` and `summaryMessage` and then calls:

```ts
        setDiscussionMessages([...formatted, ...statusMessage, ...summaryMessage]);
```

Insert before that call:

```ts
        const actionMessages = (res.moderatorActions || []).map(action => ({
          author: 'System Engine',
          role: 'system',
          time: new Date().toLocaleTimeString(),
          text: action.type === 'task'
            ? `Moderator created task card ${action.id}: ${action.title}`
            : `Moderator created ${action.filename}`
        }));
```

and change the call to:

```ts
        setDiscussionMessages([...formatted, ...statusMessage, ...actionMessages, ...summaryMessage]);
```

- [x] **Step 4: Build the desktop app**

```bash
rtk npm run build:desktop
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/desktop/main/main.ts packages/desktop/renderer/src/App.tsx
git commit -m "feat(desktop): surface moderator runtime actions in discussion chat"
```

---

### Task 8: `generateTasksFromDiscussion` engine method

The Discussion ➔ Tasks engine entry point: feed the transcript to the moderator, demand `create_task` action blocks forming an Epic→Task→Subtask plan, and execute them onto the board.

**Files:**
- Modify: `packages/engine/src/discussion/engine.ts` (add a method after `summarizeDiscussion`, near line 647)

- [x] **Step 1: Add the method**

In `packages/engine/src/discussion/engine.ts`, add after the closing brace of `summarizeDiscussion`:

```ts
  async generateTasksFromDiscussion(
    discussionId: string,
    moderatorName?: string
  ): Promise<{ createdTaskCards: TaskCard[]; errors: string[] }> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const logPath = path.join(this.dirPath, '.room', 'discussions', `${discussionId}.json`);
    const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
    const agents = await loadAgents(this.dirPath);
    const moderator = this.pickModerator(agents, moderatorName);
    if (!moderator) {
      throw new Error('No AI member is available to generate tasks.');
    }

    await this.assertAgentExecutionAllowed(moderator);
    const provider = this.getProvider(moderator);
    const transcript = renderDiscussionMarkdown(discussionLog);
    const prompt = `Convert the outcome of this ROOM chat into a structured task board plan.

Output requirements:
- Output ONLY fenced code blocks labeled room-action, one JSON object per block. No prose outside the blocks.
- Start with exactly one epic block: {"action": "create_task", "kind": "epic", "title": "<the discussion outcome>", "details": "<one-line goal>"}
- Add one block per concrete task: {"action": "create_task", "kind": "task", "title": "...", "details": "...", "parent": "<epic title>"}
- Add subtask blocks for implementation items: {"action": "create_task", "kind": "subtask", "title": "...", "parent": "<task title>"}
- Keep titles short and actionable. Skip work the chat did not actually agree on.
- Use the same natural language as the chat.

Chat transcript:
${transcript}`;

    const systemPrompt = `${moderator.systemPrompt}

${LANGUAGE_POLICY}

You convert finished ROOM chats into actionable task plans for the project task board.`;

    const content = await provider.execute(prompt, systemPrompt);
    const { actions, errors } = parseModeratorActions(content);
    const taskActions = actions.filter(action => action.action === 'create_task');
    if (taskActions.length === 0) {
      throw new Error('The moderator did not produce any create_task actions. Try again or pick another moderator.');
    }

    const executed = await executeModeratorActions(this.dirPath, taskActions, discussionId);
    return { createdTaskCards: executed.createdTaskCards, errors: [...errors, ...executed.errors] };
  }
```

- [x] **Step 2: Build and run tests**

```bash
rtk npm run build:engine
rtk npm test -w packages/engine
```

Expected: both PASS.

- [x] **Step 3: Commit**

```bash
git add packages/engine/src/discussion/engine.ts
git commit -m "feat(engine): generate task board cards from a discussion"
```

---

### Task 9: Discussion ➔ Tasks in the desktop app (button + Task Board panel)

Wire the engine method through IPC, add a "Generate Tasks (AI)" button to the discussion footer, and render the board as a tree in the Tasks tab.

**Files:**
- Modify: `packages/desktop/main/main.ts` (two new handlers after `summarize-discussion`, near line 1347; import near line 7)
- Modify: `packages/desktop/main/preload.js`
- Modify: `packages/desktop/renderer/src/App.tsx`

- [x] **Step 1: Add IPC handlers in `main.ts`**

In the `@room/engine` import at the top of `packages/desktop/main/main.ts`, add `loadTaskBoard` to the imported names list.

After the `summarize-discussion` handler's closing `});` (around line 1347), add:

```ts
ipcMain.handle('generate-tasks-from-discussion', async (event, { dirPath, discussionId, moderatorName }: { dirPath: string; discussionId: string; moderatorName?: string }) => {
  try {
    await applyApiKeysToEnvironment();
    const projectRoot = requireBoundProjectRoot(dirPath);
    const safeDiscussionId = typeof discussionId === 'string' && /^discussion-\d+$/.test(discussionId)
      ? discussionId
      : '';
    if (!safeDiscussionId) {
      return { success: false, error: 'Invalid discussion id.' };
    }

    const engine = new DiscussionEngine(projectRoot);
    const result = await engine.generateTasksFromDiscussion(safeDiscussionId, moderatorName);
    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-task-board', async (event, { dirPath }: { dirPath: string }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const board = await loadTaskBoard(projectRoot);
    return { success: true, cards: board.cards };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
```

- [x] **Step 2: Expose the calls in `preload.js`**

In `packages/desktop/main/preload.js`, after the `summarizeDiscussion` line, add:

```js
  generateTasksFromDiscussion: (dirPath, discussionId, options = {}) => ipcRenderer.invoke('generate-tasks-from-discussion', { dirPath, discussionId, ...options }),
  loadTaskBoard: (dirPath) => ipcRenderer.invoke('load-task-board', { dirPath }),
```

- [x] **Step 3: Add renderer types and state**

In `packages/desktop/renderer/src/App.tsx`:

(a) Near the `UIMessage` interface (line ~175), add:

```ts
interface TaskBoardCard {
  id: string;
  title: string;
  kind: 'epic' | 'task' | 'subtask';
  parentId?: string;
  details?: string;
  status: 'todo' | 'in_progress' | 'done';
  sourceDiscussionId?: string;
  createdAt: string;
}
```

(b) In the `electronAPI` declaration, after the `summarizeDiscussion` entry (line ~153), add:

```ts
      generateTasksFromDiscussion: (dirPath: string, discussionId: string, options?: { moderatorName?: string }) => Promise<{ success: boolean; createdTaskCards?: TaskBoardCard[]; errors?: string[]; error?: string }>;
      loadTaskBoard: (dirPath: string) => Promise<{ success: boolean; cards?: TaskBoardCard[]; error?: string }>;
```

(c) Next to the other discussion state hooks (search for `const [lastDiscussionLog`), add:

```ts
  const [taskBoardCards, setTaskBoardCards] = useState<TaskBoardCard[]>([]);
```

- [x] **Step 4: Load the board with project data**

Add this helper near `loadDiscussionSession` (line ~2309):

```ts
  const loadTaskBoardCards = async (dirPath: string) => {
    try {
      const res = await window.electronAPI.loadTaskBoard(dirPath);
      if (res.success && res.cards) {
        setTaskBoardCards(res.cards);
      }
    } catch {
      // Board is optional; ignore load failures.
    }
  };
```

Then find the `loadProjectData` function (it calls `window.electronAPI.getProjectData` and `setProjectData` around line 1611) and add at the end of its success path:

```ts
    await loadTaskBoardCards(dirPath);
```

(Use whatever the function's path parameter is named — match the existing variable.)

- [x] **Step 5: Add the "Generate Tasks (AI)" handler and button**

Add this handler near `summarizeActiveDiscussion` (line ~2360):

```ts
  const generateTasksFromActiveDiscussion = async () => {
    if (!projectPath || !activeDiscussionId) {
      setErrorMsg('Run or select a chat before generating tasks.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.generateTasksFromDiscussion(projectPath, activeDiscussionId, {
        moderatorName: discussionModeratorName || undefined
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to generate tasks.');
        return;
      }

      await loadProjectData(projectPath);
      setActiveTab('Tasks');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate tasks.');
    } finally {
      setLoading(false);
    }
  };
```

In the "Extract outputs" row (line ~3731, the `{lastDiscussionLog && !loading && (` block), add after the "Create Task Note" button:

```tsx
              <button className="btn-secondary" type="button" onClick={generateTasksFromActiveDiscussion} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Generate Tasks (AI)
              </button>
```

- [x] **Step 6: Render the Task Board tree in the Tasks tab**

In the `if (activeTab === 'Tasks') {` block (line ~5269), insert a board panel as the first child of the left column (the `div` with `flexDirection: 'column', gap: '14px'`), above the "Workspace task notes" text:

```tsx
            {taskBoardCards.length > 0 && (
              <div style={{ background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '14px 16px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
                  Task Board
                </div>
                {(() => {
                  const knownIds = new Set(taskBoardCards.map(card => card.id));
                  const childrenOf = new Map<string, TaskBoardCard[]>();
                  const roots: TaskBoardCard[] = [];
                  for (const card of taskBoardCards) {
                    if (card.parentId && knownIds.has(card.parentId)) {
                      const list = childrenOf.get(card.parentId) || [];
                      list.push(card);
                      childrenOf.set(card.parentId, list);
                    } else {
                      roots.push(card);
                    }
                  }
                  const renderCard = (card: TaskBoardCard, depth: number): JSX.Element => (
                    <div key={card.id} style={{ marginLeft: `${depth * 14}px`, fontSize: '0.82rem', padding: '2px 0' }}>
                      <span style={{ color: 'hsl(var(--text-muted))' }}>{card.status === 'done' ? '☑' : '☐'} </span>
                      <span style={{ color: 'hsl(var(--accent-purple))', fontWeight: 600 }}>{card.id}</span>
                      <span style={{ color: 'hsl(var(--text-muted))' }}> ({card.kind}) </span>
                      {card.title}
                      {childrenOf.get(card.id)?.map(child => renderCard(child, depth + 1))}
                    </div>
                  );
                  return roots.map(card => renderCard(card, 0));
                })()}
              </div>
            )}
```

- [x] **Step 7: Build the desktop app**

```bash
rtk npm run build:desktop
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/desktop/main/main.ts packages/desktop/main/preload.js packages/desktop/renderer/src/App.tsx
git commit -m "feat(desktop): add discussion-to-tasks generation and task board view"
```

---

### Task 10: Reference parser for the Inspector (`references.ts`)

Agents will end each reply with a ` ```room-refs ` block recording which prior messages they actually used. This task builds the parser.

**Files:**
- Create: `packages/engine/src/discussion/references.ts`
- Test: `packages/engine/src/discussion/references.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/engine/src/discussion/references.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMessageReferences } from './references.js';

describe('parseMessageReferences', () => {
  it('extracts references and strips the block from content', () => {
    const content = 'My answer builds on the research.\n\n```room-refs\n{"references": [{"author": "Researcher", "reason": "market sizing data"}]}\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([{ author: 'Researcher', reason: 'market sizing data' }]);
    expect(result.cleaned).toBe('My answer builds on the research.');
  });

  it('accepts a bare array form', () => {
    const content = 'Text.\n```room-refs\n[{"author": "Writer"}]\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([{ author: 'Writer', reason: undefined }]);
  });

  it('ignores malformed JSON but still strips the block', () => {
    const content = 'Text.\n```room-refs\n{oops}\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([]);
    expect(result.cleaned).toBe('Text.');
  });

  it('skips entries without an author', () => {
    const content = '```room-refs\n{"references": [{"reason": "no author"}, {"author": "Editor"}]}\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([{ author: 'Editor', reason: undefined }]);
  });

  it('returns content unchanged when there is no block', () => {
    const result = parseMessageReferences('Plain answer.');
    expect(result.references).toEqual([]);
    expect(result.cleaned).toBe('Plain answer.');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
rtk npm test -w packages/engine
```

Expected: FAIL — cannot resolve `./references.js`.

- [x] **Step 3: Implement `references.ts`**

Create `packages/engine/src/discussion/references.ts`:

```ts
export interface MessageReference {
  author: string;
  reason?: string;
}

const REFS_BLOCK_PATTERN = /```room-refs\s*\n([\s\S]*?)```/g;

export function parseMessageReferences(content: string): { references: MessageReference[]; cleaned: string } {
  const references: MessageReference[] = [];
  for (const match of content.matchAll(REFS_BLOCK_PATTERN)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as any)?.references;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const author = typeof entry?.author === 'string' ? entry.author.trim() : '';
      if (!author) continue;
      references.push({
        author,
        reason: typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined
      });
    }
  }
  const cleaned = content.replace(REFS_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
  return { references, cleaned };
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
rtk npm test -w packages/engine
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/engine/src/discussion/references.ts packages/engine/src/discussion/references.test.ts
git commit -m "feat(engine): add message reference parser for the discussion inspector"
```

---

### Task 11: Wire reference tracing into `runDiscussion`

Add the tracing protocol to every agent's system prompt, parse and strip the block from responses, persist references on `DiscussionMessage`, and show them in the markdown transcript.

**Files:**
- Modify: `packages/engine/src/discussion/engine.ts`
- Modify: `packages/engine/src/index.ts`

- [x] **Step 1: Import and extend `DiscussionMessage`**

In `packages/engine/src/discussion/engine.ts`, add to the new-imports block from Task 6:

```ts
import { parseMessageReferences, MessageReference } from './references.js';
```

In the `DiscussionMessage` interface (line ~11), after `contextMessages?: {...}[];` add:

```ts
  references?: MessageReference[];
```

- [x] **Step 2: Add the protocol constant**

After the `DISCUSSION_PROTOCOL` constant (line ~117), add:

```ts
const REFERENCE_TRACING_PROTOCOL = `=== Reference Tracing Protocol ===
At the very end of your reply, append exactly one fenced code block labeled room-refs recording which prior messages you actually used:
\`\`\`room-refs
{"references": [{"author": "<agent or user name>", "reason": "<why you used it>"}]}
\`\`\`
List only messages that genuinely shaped your answer. If you used none, output {"references": []}. Do not mention this block in your prose.`;
```

- [x] **Step 3: Include the protocol in agent prompts**

In `runDiscussion`, the system prompt is built with `composeAgentSystemPrompt(agent.systemPrompt, agent.provider === 'Local CLI', DISCUSSION_PROTOCOL, skillsContext, reviewProtocol, ...)` (line ~775). Add `REFERENCE_TRACING_PROTOCOL` as a section right after `DISCUSSION_PROTOCOL`:

```ts
        const systemPrompt = composeAgentSystemPrompt(
          agent.systemPrompt,
          agent.provider === 'Local CLI',
          DISCUSSION_PROTOCOL,
          REFERENCE_TRACING_PROTOCOL,
          skillsContext,
          reviewProtocol,
          `=== Project Context ===\n${projectContext}`
        );
```

- [x] **Step 4: Parse references from each response**

In `runDiscussion`, right after the line `response = cleanAgentUserContent(response);` (line ~800), add:

```ts
          const parsedRefs = parseMessageReferences(response);
          if (parsedRefs.cleaned) {
            response = parsedRefs.cleaned;
          }
```

Note: `parsedRefs` must be declared with `let` **outside** the `try` block so the catch path still compiles. Restructure as:

```ts
        let response = '';
        let agentFailed = false;
        let messageReferences: MessageReference[] = [];
        try {
          response = await provider.execute(prompt, systemPrompt, {
            // ... unchanged onChunk ...
          });
          response = cleanAgentUserContent(response);
          const parsedRefs = parseMessageReferences(response);
          messageReferences = parsedRefs.references;
          if (parsedRefs.cleaned) {
            response = parsedRefs.cleaned;
          }
          // ... unchanged Local CLI / success bookkeeping ...
```

Then in the `const msg: DiscussionMessage = {...}` literal (line ~823), add after `contextMessages`:

```ts
          ...(messageReferences.length > 0 ? { references: messageReferences } : {})
```

- [x] **Step 5: Show references in the markdown transcript**

In `renderDiscussionMarkdown` (line ~221), in the agent-message branch, after the `contextSummary` computation add:

```ts
    const references = message.references || [];
    const referenceSection = references.length > 0
      ? `\n### References used\n${references.map(ref => `- ${ref.author}${ref.reason ? ` — ${ref.reason}` : ''}`).join('\n')}\n`
      : '';
```

and change the returned template from:

```
### Context received
${contextSummary}

### Response
```

to:

```
### Context received
${contextSummary}
${referenceSection}
### Response
```

- [x] **Step 6: Export the module**

In `packages/engine/src/index.ts`, add after the Task 6 exports:

```ts
export * from './discussion/references.js';
```

- [x] **Step 7: Build and run all tests**

```bash
rtk npm run build:engine
rtk npm test -w packages/engine
```

Expected: both PASS.

- [x] **Step 8: Commit**

```bash
git add packages/engine/src/discussion/engine.ts packages/engine/src/index.ts
git commit -m "feat(engine): trace message references during discussions"
```

---

### Task 12: Discussion Inspector panel in the desktop app

A toggleable panel under the discussion input that renders the reference tree: per message, who was used and why; falls back to the context-message count for messages without explicit references (e.g. old logs).

**Files:**
- Modify: `packages/desktop/renderer/src/App.tsx`

- [x] **Step 1: Extend the log message type**

In the `runDiscussion` return type in the `electronAPI` declaration (the `log.messages` array element type, line ~103), add after `contextMessages?`:

```ts
            references?: { author: string; reason?: string }[];
```

- [x] **Step 2: Add inspector state**

Next to the other discussion state hooks (search for `const [lastDiscussionLog`), add:

```ts
  const [showInspector, setShowInspector] = useState(false);
```

- [x] **Step 3: Add the toggle button**

In the "Extract outputs" row (the `{lastDiscussionLog && !loading && (` block, line ~3731), add after the "Generate Tasks (AI)" button from Task 9:

```tsx
              <button className="btn-secondary" type="button" onClick={() => setShowInspector(prev => !prev)} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                {showInspector ? 'Hide Inspector' : 'Inspector'}
              </button>
```

- [x] **Step 4: Render the inspector panel**

Immediately after the closing `)}` of the "Extract outputs" block, add:

```tsx
          {showInspector && lastDiscussionLog && !loading && (
            <div style={{ marginTop: '12px', background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '14px 16px', maxHeight: '320px', overflowY: 'auto' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
                Discussion Inspector — who used what
              </div>
              {(lastDiscussionLog.messages || []).map((message: any, index: number) => {
                if (message.type === 'user') {
                  return (
                    <div key={index} style={{ fontSize: '0.85rem', fontWeight: 600, padding: '4px 0' }}>
                      ● {message.agentName} (user)
                    </div>
                  );
                }
                const refs = Array.isArray(message.references) ? message.references : [];
                const contextCount = Array.isArray(message.contextMessages) ? message.contextMessages.length : 0;
                return (
                  <div key={index} style={{ marginLeft: '14px', padding: '4px 0' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {message.agentName} ({message.providerName})
                    </div>
                    {refs.length > 0 ? (
                      refs.map((ref: any, refIndex: number) => (
                        <div key={refIndex} style={{ marginLeft: '14px', fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>
                          ↳ used {ref.author}{ref.reason ? ` — ${ref.reason}` : ''}
                        </div>
                      ))
                    ) : (
                      <div style={{ marginLeft: '14px', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                        ↳ no explicit references recorded ({contextCount} context message{contextCount === 1 ? '' : 's'} received)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
```

- [x] **Step 5: Build the desktop app**

```bash
rtk npm run build:desktop
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/desktop/renderer/src/App.tsx
git commit -m "feat(desktop): add discussion inspector panel"
```

---

### Task 13: Final validation and docs

**Files:**
- Modify: `PROPOSED_FEATURES.md`

- [x] **Step 1: Full build and test sweep**

```bash
rtk npm run build:engine
rtk npm test -w packages/engine
rtk npm run build:desktop
```

Expected: all PASS.

- [x] **Step 2: Manual smoke test**

```bash
rtk npm run dev:desktop
```

Verify in the app:
1. Run a discussion with 2+ agents and **Quality Gate enabled**. Confirm the moderator's verdict message shows clean text (no raw ` ```room-action ` JSON), and if the moderator emitted actions, system messages appear ("Moderator created task card ...").
2. Click **Generate Tasks (AI)** after a discussion. Confirm the app switches to the Tasks tab and the **Task Board** panel shows an epic with child tasks; `.room/tasks/board.json` and `board.md` exist.
3. Click **Inspector**. Confirm each agent message lists `↳ used <agent> — <reason>` lines (new discussions) or the context-count fallback (old logs).

Known limitation (acceptable): during streaming, the `room-refs` block may flash in the live chunk view; it disappears once the message completes.

- [x] **Step 3: Update `PROPOSED_FEATURES.md`**

In the Tier S section, mark the three features as shipped by appending a status line under each heading:

- Under `### 1. Discussion Inspector (SSS Rank)`: `> **Status: Implemented** — reference tracing protocol + Inspector panel in Discussions.`
- Under `### 2. Moderator Runtime Actions`: `> **Status: Implemented** — room-action blocks executed by the quality gate (continue/stop/create_task/create_adr).`
- Under `### 3. Discussion ➔ Task (First-Class Feature)`: `> **Status: Implemented** — "Generate Tasks (AI)" creates an Epic→Task→Subtask board at .room/tasks/board.json.`

- [x] **Step 4: Commit**

```bash
git add PROPOSED_FEATURES.md
git commit -m "docs: mark tier s core workflow features as implemented"
```
