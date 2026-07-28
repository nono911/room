// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn()
}));
const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null)
  },
  dialog: {
    showMessageBox: mocks.showMessageBox
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    })
  }
}));

import { registerMcpIpc } from '../../main/ipc/mcp.js';
import { bindCurrentRoom } from '../../main/ipc/shared.js';

async function bindFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-mcp-ipc-'));
  const roomRoot = path.join(root, 'rooms', 'room_personal');
  await fs.mkdir(roomRoot, { recursive: true });
  const record = {
    roomRoot,
    manifest: {
      schemaVersion: 1 as const,
      id: 'room_personal',
      name: 'Personal Room',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      sources: []
    }
  };
  await fs.writeFile(path.join(roomRoot, 'room.json'), JSON.stringify(record.manifest), 'utf-8');
  bindCurrentRoom(record);
  return roomRoot;
}

describe('MCP IPC process boundary', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    mocks.showMessageBox.mockReset();
    registerMcpIpc();
  });

  it('rejects MCP command persistence without native approval', async () => {
    const roomRoot = await bindFixture();
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
    const handler = ipcHandlers.get('save-mcp-config');
    const result = await handler?.({}, {
      roomId: 'room_personal',
      config: { mcpServers: { local: { command: 'node', args: ['server.js'] } } }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('not approved');
    await expect(fs.access(path.join(roomRoot, 'mcp.json'))).rejects.toThrow();
  });

  it('persists validated MCP commands only after native approval', async () => {
    const roomRoot = await bindFixture();
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const handler = ipcHandlers.get('save-mcp-config');
    const result = await handler?.({}, {
      roomId: 'room_personal',
      config: { mcpServers: { local: { command: 'node', args: ['server.js'] } } }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(roomRoot, 'mcp.json'), 'utf-8')).toContain('"command": "node"');
  });

  it('rejects plaintext MCP environment secrets', async () => {
    await bindFixture();
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const handler = ipcHandlers.get('save-mcp-config');
    const result = await handler?.({}, {
      roomId: 'room_personal',
      config: {
        mcpServers: {
          local: { command: 'node', env: { TOKEN: 'plaintext-secret' } }
        }
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('environment secrets');
  });
});
