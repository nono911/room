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

const temporaryRoots: string[] = [];
const originalRoomHome = process.env.ROOM_HOME;

beforeEach(async () => {
  mocks.handlers.clear();
  mocks.showOpenDialog.mockReset();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-workspace-ipc-'));
  temporaryRoots.push(root);
  process.env.ROOM_HOME = path.join(root, 'home');
  registerWorkspaceIpc(() => ({}) as never);
});

afterEach(async () => {
  if (originalRoomHome === undefined) delete process.env.ROOM_HOME;
  else process.env.ROOM_HOME = originalRoomHome;
  await Promise.all(temporaryRoots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('Room and Source workspace IPC', () => {
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
      room: { sources: Array<{ id: string }> };
    };
    expect(attached.success).toBe(true);
    expect(attached.room.sources).toHaveLength(1);

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
});
