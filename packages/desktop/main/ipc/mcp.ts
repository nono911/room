import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  requireBoundProjectRoot, resolveWithinRoomData
} from './shared.js';
import { readMcpConfigFromDisk, validateMcpConfig } from './config-store.js';

export function registerMcpIpc(): void {
  ipcMain.handle('load-mcp-config', async (event, dirPath: string) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const config = await readMcpConfigFromDisk(projectRoot);
      return { success: true, config };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-mcp-config', async (event, { dirPath, config }: { dirPath: string; config: any }) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const mcpPath = resolveWithinRoomData(projectRoot, 'mcp.json');
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
