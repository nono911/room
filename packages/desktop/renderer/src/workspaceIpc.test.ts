// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: unknown, payload?: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showOpenDialog: vi.fn()
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {
    showOpenDialog: mocks.showOpenDialog
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler);
    })
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}));

import { registerWorkspaceIpc } from '../../main/ipc/workspace.js';
import { registerFilesIpc } from '../../main/ipc/files.js';
import {
  LocalCliProvider,
  serializeTaskCanonical,
  type CodingTaskResult
} from '@room/engine';

const temporaryRoots: string[] = [];
const originalRoomHome = process.env.ROOM_HOME;

function canonicalTask(
  id: string,
  title: string,
  overrides: Partial<CodingTaskResult> = {}
): CodingTaskResult {
  return {
    id,
    title,
    task: title,
    taskType: 'general',
    status: 'approved',
    cycles: 1,
    messages: [],
    markdownFilename: `${id}.md`,
    jsonFilename: `${id}.json`,
    statusSummary: `${title} completed.`,
    sourceProvenance: {
      mode: 'room-only',
      roomId: 'room_personal',
      startedAt: '2026-07-27T00:00:00.000Z'
    },
    ...overrides,
    participants: overrides.participants || []
  };
}

beforeEach(async () => {
  mocks.handlers.clear();
  mocks.showOpenDialog.mockReset();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-workspace-ipc-'));
  temporaryRoots.push(root);
  process.env.ROOM_HOME = path.join(root, 'home');
  registerWorkspaceIpc(() => ({}) as never);
  registerFilesIpc();
});

afterEach(async () => {
  if (originalRoomHome === undefined) delete process.env.ROOM_HOME;
  else process.env.ROOM_HOME = originalRoomHome;
  await Promise.all(temporaryRoots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('Room and Source workspace IPC', () => {
  it('rejects symlinked Room files instead of returning outside data', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const getRoomData = mocks.handlers.get('get-room-data');
    await initialize?.({});
    const roomRoot = path.join(process.env.ROOM_HOME!, 'rooms', 'room_personal');
    const external = path.join(temporaryRoots[0], 'outside.txt');
    await fs.writeFile(external, 'outside secret', 'utf-8');
    await fs.rm(path.join(roomRoot, 'context', 'overview.md'));
    await fs.symlink(external, path.join(roomRoot, 'context', 'overview.md'));

    const result = await getRoomData?.({}, 'room_personal') as {
      success: boolean;
      error?: string;
    };
    expect(result).toMatchObject({
      success: false,
      error: 'ROOM data could not be loaded.'
    });
    expect(result.error).not.toContain(temporaryRoots[0]);
  });

  it('drops the unused strategy field from Home agents while keeping systemPrompt for the editor', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const getRoomData = mocks.handlers.get('get-room-data');
    await initialize?.({});
    const membersDir = path.join(
      process.env.ROOM_HOME!,
      'rooms',
      'room_personal',
      'members'
    );
    await fs.writeFile(
      path.join(membersDir, 'mem_strategy_test.json'),
      JSON.stringify({
        id: 'mem_strategy_test',
        name: 'Strategy Test',
        role: 'Tester',
        provider: 'gemini',
        systemPrompt: 'Do the work carefully.',
        // Only used at execution time (loadAgents re-reads it from disk), so
        // the Home aggregate must not pay its byte cost.
        strategy: 'Internal execution strategy notes.'
      }),
      'utf-8'
    );

    const result = await getRoomData?.({}, 'room_personal') as {
      success: boolean;
      agents: Array<Record<string, unknown>>;
    };
    expect(result.success).toBe(true);
    const agent = result.agents.find(entry => entry.id === 'mem_strategy_test');
    expect(agent).toMatchObject({ systemPrompt: 'Do the work carefully.' });
    expect(agent).not.toHaveProperty('strategy');
  });

  it('initializes source-less, attaches and detaches by ID, and preserves both sides', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const attach = mocks.handlers.get('attach-room-source');
    const detach = mocks.handlers.get('detach-room-source');
    const listSourceFiles = mocks.handlers.get('list-source-files');
    expect(initialize).toBeTypeOf('function');
    expect(attach).toBeTypeOf('function');
    expect(detach).toBeTypeOf('function');

    const initialized = await initialize?.({}) as {
      success: boolean;
      room: { id: string; sources: Array<{ id: string }> };
    };
    expect(initialized).toMatchObject({
      success: true,
      room: { id: 'room_personal', sources: [] }
    });

    const roomRoot = path.join(process.env.ROOM_HOME!, 'rooms', 'room_personal');
    const memoryPath = path.join(roomRoot, 'documents', 'memory.md');
    await fs.writeFile(memoryPath, '# Memory\n', 'utf-8');
    const sourceRoot = path.join(temporaryRoots[0], 'source');
    await fs.mkdir(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, 'keep.txt'), 'source', 'utf-8');
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourceRoot] });

    const attached = await attach?.({}, { roomId: 'room_personal' }) as {
      success: boolean;
      room: { sources: Array<{ id: string } & Record<string, unknown>> };
    };
    expect(attached.success).toBe(true);
    expect(attached.room.sources).toHaveLength(1);
    expect(attached.room.sources[0]).not.toHaveProperty('path');

    const detached = await detach?.({}, {
      roomId: 'room_personal',
      sourceId: attached.room.sources[0].id
    }) as { success: boolean; room: { sources: unknown[] } };
    expect(detached).toMatchObject({ success: true, room: { sources: [] } });
    expect(await fs.readFile(memoryPath, 'utf-8')).toBe('# Memory\n');
    expect(await fs.readFile(path.join(sourceRoot, 'keep.txt'), 'utf-8')).toBe('source');

    const sourceLessFiles = await listSourceFiles?.({}, {
      roomId: 'room_personal',
      sourceId: undefined
    }) as { success: boolean; error?: string };
    expect(sourceLessFiles.success).toBe(false);
    expect(sourceLessFiles.error).toContain('Attach a Source');
  });

  it('loads bounded canonical task headers without parsing full transcripts on Home startup', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const getRoomData = mocks.handlers.get('get-room-data');
    await initialize?.({});
    const tasksRoot = path.join(
      process.env.ROOM_HOME!,
      'rooms',
      'room_personal',
      'tasks'
    );
    await fs.writeFile(
      path.join(tasksRoot, 'task-large.json'),
      serializeTaskCanonical(canonicalTask('task-large', 'Large task', {
        messages: [{
          agentName: 'Doer',
          providerName: 'test',
          content: 'x'.repeat(5 * 1024 * 1024),
          timestamp: '2026-07-27T00:00:01.000Z'
        }]
      })),
      'utf-8'
    );

    const result = await getRoomData?.({}, 'room_personal') as {
      success: boolean;
      taskRuns: Array<{ title: string }>;
    };
    expect(result.success).toBe(true);
    expect(result.taskRuns).toEqual([
      expect.objectContaining({ title: 'Large task' })
    ]);
  });

  it('uses the canonical task record even when stale legacy sidecars remain', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const getRoomData = mocks.handlers.get('get-room-data');
    await initialize?.({});
    const tasksRoot = path.join(
      process.env.ROOM_HOME!,
      'rooms',
      'room_personal',
      'tasks'
    );
    await fs.writeFile(path.join(tasksRoot, 'task-generation.json'), serializeTaskCanonical(
      canonicalTask('task-generation', 'Current task', {
        cycles: 3,
        statusSummary: 'Current generation.'
      })
    ), 'utf-8');
    await fs.writeFile(path.join(tasksRoot, 'task-generation.md'), '# Stale task\n', 'utf-8');
    await fs.writeFile(
      path.join(tasksRoot, 'task-generation.summary.json'),
      JSON.stringify({
        id: 'task-generation',
        title: 'Stale task',
        status: 'blocked',
        cycles: 1
      }),
      'utf-8'
    );

    const result = await getRoomData?.({}, 'room_personal') as {
      success: boolean;
      taskRuns: Array<{ id: string; title: string; status: string; cycles: number }>;
    };
    expect(result.taskRuns).toContainEqual(expect.objectContaining({
      id: 'task-generation',
      title: 'Current task',
      status: 'approved',
      cycles: 3
    }));
  });

  it('paginates task-run summaries independently from other task files', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const getRoomData = mocks.handlers.get('get-room-data');
    const listTaskRuns = mocks.handlers.get('list-room-task-runs');
    await initialize?.({});
    const tasksRoot = path.join(
      process.env.ROOM_HOME!,
      'rooms',
      'room_personal',
      'tasks'
    );
    await Promise.all(Array.from({ length: 205 }, async (_, index) => {
      const id = `task-run-${String(index).padStart(4, '0')}`;
      await fs.writeFile(
        path.join(tasksRoot, `${id}.json`),
        serializeTaskCanonical(canonicalTask(id, `Run ${index}`)),
        'utf-8'
      );
    }));

    const home = await getRoomData?.({}, 'room_personal') as {
      success: boolean;
      taskRuns: Array<{ id: string }>;
      taskRunPagination: { hasMore: boolean; nextCursor?: string; truncated: boolean };
    };
    expect(home.taskRuns).toHaveLength(200);
    expect(home.taskRuns[0].id).toBe('task-run-0204');
    expect(home.taskRunPagination).toMatchObject({ hasMore: true, truncated: false });

    const next = await listTaskRuns?.({}, {
      roomId: 'room_personal',
      cursor: home.taskRunPagination.nextCursor
    }) as { success: boolean; taskRuns: Array<{ id: string }>; hasMore: boolean };
    expect(next.success).toBe(true);
    expect(next.taskRuns).toHaveLength(5);
    expect(next.taskRuns[0].id).toBe('task-run-0004');
    expect(next.hasMore).toBe(false);
  });

  it('keeps a canonical task transcript visible without any derived sidecar', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const getRoomData = mocks.handlers.get('get-room-data');
    await initialize?.({});
    const tasksRoot = path.join(
      process.env.ROOM_HOME!,
      'rooms',
      'room_personal',
      'tasks'
    );
    await fs.writeFile(
      path.join(tasksRoot, 'task-recovered.json'),
      serializeTaskCanonical(canonicalTask('task-recovered', 'Recovered task', {
        cycles: 2,
        statusSummary: 'Recovered from the durable transcript.'
      })),
      'utf-8'
    );

    const result = await getRoomData?.({}, 'room_personal') as {
      success: boolean;
      taskRuns: Array<{ id: string; title: string; status: string; cycles: number }>;
    };
    expect(result.success).toBe(true);
    expect(result.taskRuns).toContainEqual(expect.objectContaining({
      id: 'task-recovered',
      title: 'Recovered task',
      status: 'approved',
      cycles: 2
    }));
  });

  it('caps Home artifact listings and reports truncation', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const getRoomData = mocks.handlers.get('get-room-data');
    await initialize?.({});
    const decisionsRoot = path.join(
      process.env.ROOM_HOME!,
      'rooms',
      'room_personal',
      'decisions'
    );
    for (let offset = 0; offset < 1_005; offset += 100) {
      await Promise.all(Array.from(
        { length: Math.min(100, 1_005 - offset) },
        (_, index) => fs.writeFile(
          path.join(decisionsRoot, `decision-${offset + index}.md`),
          '# Decision\n',
          'utf-8'
        )
      ));
    }

    const result = await getRoomData?.({}, 'room_personal') as {
      success: boolean;
      decisions: string[];
      artifactListPagination: {
        decisions: { hasMore: boolean; nextCursor?: string; truncated: boolean };
      };
    };
    expect(result.success).toBe(true);
    expect(result.decisions).toHaveLength(200);
    expect(result.artifactListPagination.decisions.hasMore).toBe(true);

    const listArtifacts = mocks.handlers.get('list-room-artifacts');
    const next = await listArtifacts?.({}, {
      roomId: 'room_personal',
      section: 'decisions',
      cursor: result.artifactListPagination.decisions.nextCursor
    }) as { success: boolean; files: string[]; hasMore: boolean; truncated: boolean };
    expect(next.success).toBe(true);
    expect(next.files).toHaveLength(200);
    expect(next.files.some(file => result.decisions.includes(file))).toBe(false);
    expect(next.hasMore).toBe(true);
    expect(next.truncated).toBe(false);
  });

  it('ignores an unconfined safe Local CLI scanner and publishes deterministic scan data', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const attach = mocks.handlers.get('attach-room-source');
    const runScan = mocks.handlers.get('run-scan');
    await initialize?.({});

    const sourceRoot = path.join(temporaryRoots[0], 'scan-source');
    await fs.mkdir(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, 'package.json'), '{"dependencies":{"react":"1"}}', 'utf-8');
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourceRoot] });
    const attached = await attach?.({}, { roomId: 'room_personal' }) as {
      room: { sources: Array<{ id: string }> };
    };
    const sourceId = attached.room.sources[0].id;
    const execute = vi.spyOn(LocalCliProvider.prototype, 'execute')
      .mockRejectedValue(new Error('overview failed'));

    const result = await runScan?.({}, {
      roomId: 'room_personal',
      sourceId,
      mainAgent: 'claude'
    }) as { success: boolean; error?: string };
    execute.mockRestore();

    expect(result.success).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    const scanRoot = path.join(
      process.env.ROOM_HOME!,
      'rooms',
      'room_personal',
      'sources',
      sourceId,
      'scan'
    );
    expect(JSON.parse(await fs.readFile(path.join(scanRoot, 'current.json'), 'utf-8')))
      .toMatchObject({ generation: expect.stringMatching(/^generation-/) });
  });

  it('searches Source entries beyond the 500-entry interactive browsing limit', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const attach = mocks.handlers.get('attach-room-source');
    const search = mocks.handlers.get('search-context-items');
    await initialize?.({});
    const sourceRoot = path.join(temporaryRoots[0], 'large-search-source');
    await fs.mkdir(sourceRoot);
    await Promise.all(Array.from({ length: 520 }, (_, index) => (
      fs.writeFile(path.join(sourceRoot, `entry-${index}.md`), `# Entry ${index}\n`, 'utf-8')
    )));
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourceRoot] });
    const attached = await attach?.({}, { roomId: 'room_personal' }) as {
      room: { sources: Array<{ id: string }> };
    };

    const result = await search?.({}, {
      roomId: 'room_personal',
      sourceId: attached.room.sources[0].id,
      query: 'entry-519'
    }) as { success: boolean; items?: Array<{ path?: string }> };
    expect(result.success).toBe(true);
    expect(result.items).toContainEqual(expect.objectContaining({ path: 'entry-519.md' }));
  });

  it('rejects oversized Source paths before dispatching pinned operations', async () => {
    const initialize = mocks.handlers.get('initialize-personal-room');
    const attach = mocks.handlers.get('attach-room-source');
    const browse = mocks.handlers.get('browse-source-files');
    const read = mocks.handlers.get('read-source-file');
    await initialize?.({});
    const sourceRoot = path.join(temporaryRoots[0], 'bounded-source');
    await fs.mkdir(sourceRoot);
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourceRoot] });
    const attached = await attach?.({}, { roomId: 'room_personal' }) as {
      room: { sources: Array<{ id: string }> };
    };
    const payload = {
      roomId: 'room_personal',
      sourceId: attached.room.sources[0].id
    };

    await expect(browse?.({}, {
      ...payload,
      directory: 'a'.repeat(5_000)
    })).resolves.toMatchObject({
      success: false,
      error: 'The request exceeds a ROOM safety limit.'
    });
    await expect(read?.({}, {
      ...payload,
      filePath: 'a'.repeat(5_000)
    })).resolves.toMatchObject({
      success: false,
      error: 'The request exceeds a ROOM safety limit.'
    });
  });
});
