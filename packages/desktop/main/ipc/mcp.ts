import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  requireBoundRoom, resolveWithinRoomData
} from './shared.js';
import { readMcpConfigFromDisk, validateMcpConfig } from './config-store.js';

export function registerMcpIpc(): void {
  ipcMain.handle('load-mcp-config', async (event, roomId: string) => {
    try {
      requireBoundRoom(roomId);
      const config = await readMcpConfigFromDisk(roomId);
      return { success: true, config };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-mcp-config', async (event, { roomId, config }: { roomId: string; config: any }) => {
    try {
      requireBoundRoom(roomId);
      const mcpPath = resolveWithinRoomData(roomId, 'mcp.json');
      const validated = validateMcpConfig(config);
      if (!validated.success) {
        return { success: false, error: validated.error };
      }
      await fs.mkdir(path.dirname(mcpPath), { recursive: true });
      await fs.writeFile(mcpPath, JSON.stringify(validated.config, null, 2), 'utf-8');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
