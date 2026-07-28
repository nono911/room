import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  requireBoundRoom, resolveWithinRoomData
} from './shared.js';
import {
  readMcpConfigFromDisk,
  validateMcpConfig
} from './config-store.js';
import { confirmNativeApproval } from './native-approval.js';
import { writeRoomDataFileAtomically } from './room-file-write.js';
import { assertJsonBytes, IPC_LIMITS } from './ipc-limits.js';
import { toPublicError } from './public-error.js';

export function registerMcpIpc(): void {
  ipcMain.handle('load-mcp-config', async (_event, roomId: string) => {
    try {
      requireBoundRoom(roomId);
      const config = await readMcpConfigFromDisk(roomId);
      return { success: true, config };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('save-mcp-config', async (event, { roomId, config }: { roomId: string; config: any }) => {
    try {
      assertJsonBytes(config, 'MCP configuration', IPC_LIMITS.teamPayloadBytes);
      requireBoundRoom(roomId);
      const mcpPath = resolveWithinRoomData(roomId, 'mcp.json');
      const validated = validateMcpConfig(config);
      if (!validated.success) {
        return { success: false, error: validated.error };
      }
      const approved = await confirmNativeApproval(
        event,
        'Allow MCP processes?',
        'MCP configuration can start local executable processes.',
        'Review every command and argument. ROOM does not pass inline environment secrets to MCP servers.'
      );
      if (!approved) return { success: false, error: 'MCP configuration was not approved.' };
      await fs.mkdir(path.dirname(mcpPath), { recursive: true });
      await writeRoomDataFileAtomically(
        roomId,
        ['mcp.json'],
        JSON.stringify(validated.config, null, 2)
      );
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });
}
