// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    })
  }
}));

import { registerFilesIpc } from '../../main/ipc/files.js';
import { bindCurrentRoom } from '../../main/ipc/shared.js';

describe('Room file IPC bounds', () => {
  it('rejects oversized renderer previews before reading the file body', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-file-ipc-'));
    const roomRoot = path.join(root, 'rooms', 'room_personal');
    const documentsRoot = path.join(roomRoot, 'documents');
    await fs.mkdir(documentsRoot, { recursive: true });
    const manifest = {
      schemaVersion: 1 as const,
      id: 'room_personal',
      name: 'Personal Room',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
      sources: []
    };
    await fs.writeFile(path.join(roomRoot, 'room.json'), JSON.stringify(manifest), 'utf-8');
    await fs.writeFile(
      path.join(documentsRoot, 'oversized.md'),
      'x'.repeat(4 * 1024 * 1024 + 1),
      'utf-8'
    );
    bindCurrentRoom({ roomRoot, manifest });
    registerFilesIpc();

    const result = await handlers.get('read-room-file')?.({}, {
      roomId: 'room_personal',
      section: 'documents',
      filename: 'oversized.md'
    }) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe('The request exceeds a ROOM safety limit.');

    const hiddenWrite = await handlers.get('save-room-file')?.({}, {
      roomId: 'room_personal',
      section: 'documents',
      filename: '.hidden.md',
      content: '# hidden'
    }) as { success: boolean; error?: string };
    expect(hiddenWrite.success).toBe(false);
    expect(await fs.stat(path.join(documentsRoot, '.hidden.md')).catch(() => null)).toBeNull();
    await fs.rm(root, { recursive: true, force: true });
  });
});
