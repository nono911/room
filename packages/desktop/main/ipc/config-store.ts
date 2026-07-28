import { readRoomTextFile } from '@room/engine';
import {
  isObjectWithAllowedKeys,
  isPlainObject,
  requireBoundRoomWorkspace
} from './shared.js';

export const ALLOWED_MCP_CONFIG_KEYS = ['mcpServers'] as const;

export interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
  }>;
}

export function validateMcpConfig(rawConfig: unknown): { success: true; config: McpConfig } | { success: false; error: string } {
  if (!isPlainObject(rawConfig)) {
    return { success: false, error: 'Invalid MCP config format.' };
  }

  if (!isObjectWithAllowedKeys(rawConfig, ALLOWED_MCP_CONFIG_KEYS)) {
    return { success: false, error: 'MCP config contains unsupported keys.' };
  }

  if (!isPlainObject(rawConfig.mcpServers)) {
    return { success: false, error: 'MCP config.mcpServers must be an object.' };
  }

  const mcpServers: Record<string, { command: string; args?: string[] }> = {};

  for (const [serverName, serverConfig] of Object.entries(rawConfig.mcpServers)) {
    if (typeof serverName !== 'string' || !serverName.trim()) {
      return { success: false, error: 'MCP server name must be a non-empty string.' };
    }

    if (!isPlainObject(serverConfig)) {
      return { success: false, error: `Invalid MCP server config for ${serverName}.` };
    }

    const rawServerConfig = serverConfig as Record<string, unknown>;
    if (rawServerConfig.command === undefined || typeof rawServerConfig.command !== 'string' || !rawServerConfig.command.trim()) {
      return { success: false, error: `Missing or invalid command for MCP server ${serverName}.` };
    }

    if (rawServerConfig.args !== undefined) {
      if (!Array.isArray(rawServerConfig.args) || !rawServerConfig.args.every((arg) => typeof arg === 'string')) {
        return { success: false, error: `Invalid args for MCP server ${serverName}.` };
      }
    }

    if (rawServerConfig.env !== undefined) {
      return {
        success: false,
        error: `Inline MCP environment secrets are not supported for ${serverName}.`
      };
    }
    if (!isObjectWithAllowedKeys(rawServerConfig, ['command', 'args'] as const)) {
      return { success: false, error: `Unsupported MCP server keys for ${serverName}.` };
    }

    const args = Array.isArray(rawServerConfig.args)
      ? rawServerConfig.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined;
    mcpServers[serverName] = {
      command: rawServerConfig.command.trim(),
      ...(args && args.length > 0 ? { args } : {})
    };
  }

  return { success: true, config: { mcpServers } };
}

export async function readMcpConfigFromDisk(projectRoot: string): Promise<McpConfig> {
  try {
    const content = await readRoomTextFile(
      requireBoundRoomWorkspace(projectRoot),
      ['mcp.json'],
      1024 * 1024
    );
    const parsed = JSON.parse(content);
    const validated = validateMcpConfig(parsed);
    if (validated.success) {
      return validated.config;
    }
    return { mcpServers: {} };
  } catch {
    return { mcpServers: {} };
  }
}
