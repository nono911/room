import * as fs from 'fs/promises';
import { normalizeLocalCliModelName } from '@room/engine';
import {
  SUPPORTED_LOCAL_CLI_PRESETS,
  isObjectWithAllowedKeys,
  isPlainObject,
  resolveWithinRoomData
} from './shared.js';

export const ALLOWED_PROJECT_MAIN_AGENTS = ['none', ...SUPPORTED_LOCAL_CLI_PRESETS] as const;
export const ALLOWED_PROJECT_MAIN_AGENT_SET = new Set<string>(ALLOWED_PROJECT_MAIN_AGENTS);
export const ALLOWED_PROJECT_CONFIG_KEYS = ['mainAgent', 'modelName', 'allowDangerousCli'] as const;
export const ALLOWED_MCP_CONFIG_KEYS = ['mcpServers'] as const;

export type ProjectMainAgent = typeof ALLOWED_PROJECT_MAIN_AGENTS[number];

export interface ProjectConfig {
  mainAgent: ProjectMainAgent;
  modelName?: string;
  allowDangerousCli: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

export function validateProjectConfig(rawConfig: unknown): { success: true; config: ProjectConfig } | { success: false; error: string } {
  if (!isPlainObject(rawConfig)) {
    return { success: false, error: 'Invalid project config format.' };
  }

  if (!isObjectWithAllowedKeys(rawConfig, ALLOWED_PROJECT_CONFIG_KEYS)) {
    return { success: false, error: 'Project config contains unsupported keys.' };
  }

  const mainAgentRaw = typeof rawConfig.mainAgent === 'string' ? rawConfig.mainAgent.trim() : 'none';
  if (!ALLOWED_PROJECT_MAIN_AGENT_SET.has(mainAgentRaw)) {
    return { success: false, error: 'Invalid main agent.' };
  }
  const mainAgent = mainAgentRaw as ProjectMainAgent;

  if (rawConfig.modelName !== undefined && rawConfig.modelName !== null && typeof rawConfig.modelName !== 'string') {
    return { success: false, error: 'Invalid model name format.' };
  }
  const modelName = typeof rawConfig.modelName === 'string' ? normalizeLocalCliModelName(rawConfig.modelName) : undefined;

  if (rawConfig.allowDangerousCli !== undefined && typeof rawConfig.allowDangerousCli !== 'boolean') {
    return { success: false, error: 'Invalid dangerous permission flag.' };
  }

  return {
    success: true,
    config: {
      mainAgent,
      ...(modelName ? { modelName } : {}),
      allowDangerousCli: rawConfig.allowDangerousCli === true
    }
  };
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

  const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};

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
      if (!isPlainObject(rawServerConfig.env)) {
        return { success: false, error: `Invalid env for MCP server ${serverName}.` };
      }
      const envEntries = Object.entries(rawServerConfig.env as Record<string, unknown>);
      for (const [key, value] of envEntries) {
        if (typeof key !== 'string' || typeof value !== 'string') {
          return { success: false, error: `Invalid env value for MCP server ${serverName}.` };
        }
      }
    }

    const args = Array.isArray(rawServerConfig.args)
      ? rawServerConfig.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined;
    const env = isPlainObject(rawServerConfig.env)
      ? Object.fromEntries(
          Object.entries(rawServerConfig.env as Record<string, unknown>).filter(([, v]) => typeof v === 'string') as [string, string][]
        )
      : undefined;

    mcpServers[serverName] = {
      command: rawServerConfig.command.trim(),
      ...(args && args.length > 0 ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {})
    };
  }

  return { success: true, config: { mcpServers } };
}

export async function readProjectConfigFromDisk(projectRoot: string): Promise<ProjectConfig> {
  const projectConfigPath = resolveWithinRoomData(projectRoot, 'config.json');
  try {
    const content = await fs.readFile(projectConfigPath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = validateProjectConfig(parsed);
    if (validated.success) {
      return validated.config;
    }
    return { mainAgent: 'none', allowDangerousCli: false };
  } catch {
    return { mainAgent: 'none', allowDangerousCli: false };
  }
}

export async function readMcpConfigFromDisk(projectRoot: string): Promise<McpConfig> {
  const mcpPath = resolveWithinRoomData(projectRoot, 'mcp.json');
  try {
    const content = await fs.readFile(mcpPath, 'utf-8');
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

export function isDangerousAgentAllowed(projectRoot: string): Promise<boolean> {
  return readProjectConfigFromDisk(projectRoot)
    .then((projectConfig) => projectConfig.allowDangerousCli)
    .catch(() => false);
}
