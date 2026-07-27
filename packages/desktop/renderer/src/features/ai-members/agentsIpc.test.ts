// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (...args: any[]) => Promise<unknown>>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    })
  }
}));

vi.mock('../../../../main/ipc/config-store.js', () => ({
  isDangerousAgentAllowed: vi.fn().mockResolvedValue(false)
}));

import { bindCurrentRoom } from '../../../../main/ipc/shared.js';
import { registerAgentsIpc } from '../../../../main/ipc/agents.js';

describe('registerAgentsIpc save-agent', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    registerAgentsIpc();
  });

  it('materializes a stable member id when saving a manual member without one', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-manual-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(roomRoot, { recursive: true });
    bindCurrentRoom({
      roomRoot,
      manifest: {
        schemaVersion: 1,
        id: 'room_personal',
        name: 'Personal Room',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        sources: []
      }
    });

    const saveAgentHandler = ipcHandlers.get('save-agent');
    expect(saveAgentHandler).toBeTypeOf('function');

    const result = await saveAgentHandler?.({}, {
      roomId: 'room_personal',
      agent: {
        name: 'Manual Researcher',
        role: 'Research',
        provider: 'gemini',
        systemPrompt: 'Investigate the workspace.'
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);

    const membersDir = path.join(roomRoot, 'members');
    const files = await fs.readdir(membersDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}\.json$/);

    const saved = JSON.parse(await fs.readFile(path.join(membersDir, files[0]), 'utf-8')) as { id?: string; name: string };
    expect(saved.id).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}$/);
    expect(saved.name).toBe('Manual Researcher');
  });

  it('materializes a legacy member onto an id-backed file and removes the old legacy file when renaming', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-legacy-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(roomRoot, { recursive: true });
    bindCurrentRoom({
      roomRoot,
      manifest: {
        schemaVersion: 1,
        id: 'room_personal',
        name: 'Personal Room',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        sources: []
      }
    });

    const membersDir = path.join(roomRoot, 'members');
    await fs.mkdir(membersDir, { recursive: true });
    await fs.writeFile(
      path.join(membersDir, 'planner.json'),
      JSON.stringify({
        name: 'Planner',
        role: 'Planning',
        provider: 'gemini',
        systemPrompt: 'Plan the work.'
      }, null, 2),
      'utf-8'
    );

    const saveAgentHandler = ipcHandlers.get('save-agent');
    expect(saveAgentHandler).toBeTypeOf('function');

    const result = await saveAgentHandler?.({}, {
      roomId: 'room_personal',
      agent: {
        previousName: 'Planner',
        name: 'Lead Planner',
        role: 'Planning',
        provider: 'gemini',
        systemPrompt: 'Plan the work.'
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);

    const files = (await fs.readdir(membersDir)).sort();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}\.json$/);
    await expect(fs.access(path.join(membersDir, 'planner.json'))).rejects.toThrow();

    const saved = JSON.parse(await fs.readFile(path.join(membersDir, files[0]), 'utf-8')) as { id?: string; name: string };
    expect(saved.id).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}$/);
    expect(saved.name).toBe('Lead Planner');
  });
});
