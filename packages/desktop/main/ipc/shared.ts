import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';
import { builtInProviderEntries, isValidProviderId, normalizeLocalCliModelName, type ProviderEntry } from '@room/engine';

export const ROOM_DIR = '.room';
export const SUPPORTED_LOCAL_CLI_PRESETS = ['claude', 'gemini', 'codex', 'copilot', 'codewhale', 'agy'] as const;
export const ALLOWED_PROJECT_MAIN_AGENTS = ['none', ...SUPPORTED_LOCAL_CLI_PRESETS] as const;
export const SUPPORTED_LOCAL_CLI_PRESETS_SET = new Set<string>(SUPPORTED_LOCAL_CLI_PRESETS);
export const ALLOWED_PROJECT_MAIN_AGENT_SET = new Set<string>(ALLOWED_PROJECT_MAIN_AGENTS);
export const ALLOWED_PROJECT_CONFIG_KEYS = ['mainAgent', 'modelName', 'allowDangerousCli'] as const;
export const ALLOWED_MCP_CONFIG_KEYS = ['mcpServers'] as const;
export const ALLOWED_ROOM_FILE_SECTIONS = ['documents', 'tasks', 'discussions', 'decisions', 'reviews', 'skills'] as const;
export const WORKSPACE_FILE_LIMIT = 500;
export const WORKSPACE_FILE_READ_LIMIT_BYTES = 1024 * 1024;
export const CONTEXT_SEARCH_SCAN_LIMIT = 2500;
export const CONTEXT_SEARCH_RESULT_LIMIT = 80;
export const CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES = 48 * 1024;
export const DISCUSSION_CONTEXT_FILE_LIMIT_BYTES = 200 * 1024;
export const DISCUSSION_CONTEXT_TOTAL_LIMIT = 700 * 1024;
export const IGNORED_WORKSPACE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-packaged',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache'
]);

export interface ApiKeyConfig {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

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

export interface ContextSearchResult {
  ref: string;
  label: string;
  type: 'workspace' | 'task' | 'doc' | 'discussion' | 'file';
  path?: string;
  detail: string;
  modifiedAt?: string;
  size?: number;
}

export interface SkillPreviewItem {
  filename: string;
  readable: boolean;
  source?: 'skills' | 'roles';
  bytes?: number;
  heading?: string;
  error?: string;
}

let currentProjectRoot: string | null = null;

export function resolveProjectPath(dirPath: string): string {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    throw new Error('Invalid project path.');
  }
  return path.resolve(dirPath);
}

export function bindCurrentProjectRoot(dirPath: string): string {
  const projectRoot = resolveProjectPath(dirPath);
  currentProjectRoot = projectRoot;
  return projectRoot;
}

export function requireBoundProjectRoot(dirPath: string): string {
  const projectRoot = resolveProjectPath(dirPath);
  if (!currentProjectRoot || projectRoot !== currentProjectRoot) {
    throw new Error('Project path is not the active workspace.');
  }
  return projectRoot;
}

export function resolveWithinProject(projectRoot: string, ...parts: string[]): string {
  const root = resolveProjectPath(projectRoot);
  const resolved = path.resolve(root, ...parts);
  const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(safeRoot)) {
    throw new Error('Invalid project path.');
  }
  return resolved;
}

export function sanitizeFileName(input: string, fallback = 'untitled'): string {
  const name = path.basename(input || '').trim();
  if (!name) return fallback;
  return name;
}

export function sanitizeWorkspaceRelativePath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Invalid workspace file path.');
  }

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid workspace file path.');
  }

  return normalized;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isAllowed(value: string, allowed: readonly string[]): value is string {
  return allowed.includes(value);
}

export function sanitizeAgentFileName(name: string): string {
  const normalized = path.basename(name.toLowerCase()).trim();
  return normalized.replace(/[^a-z0-9_-]/g, '-');
}

export function isObjectWithAllowedKeys(value: unknown, allowedKeys: readonly string[]): boolean {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath);
    return files.filter(f => !f.startsWith('.'));
  } catch {
    return [];
  }
}

export async function readFirstExistingFile(paths: string[]): Promise<string> {
  for (const filePath of paths) {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {}
  }
  return '';
}

export async function readMergedDirs(dirs: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of dirs) {
    const files = await safeReadDir(dir);
    for (const file of files) {
      names.add(file);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export async function readTextFileWithLimit(filePath: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('Selected item is not a file.');
  }
  if (stat.size > maxBytes) {
    throw new Error('File is too large to include as discussion context.');
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) {
    throw new Error('Binary files cannot be included as discussion context.');
  }
  return buffer.toString('utf-8');
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
  const projectConfigPath = resolveWithinProject(projectRoot, ROOM_DIR, 'config.json');
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
  const mcpPath = resolveWithinProject(projectRoot, ROOM_DIR, 'mcp.json');
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

export function getApiKeysPath(): string {
  return path.join(app.getPath('userData'), 'api-keys.json');
}

export async function readApiKeysFromDisk(): Promise<ApiKeyConfig> {
  try {
    const content = await fs.readFile(getApiKeysPath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (!isPlainObject(parsed)) return {};

    return {
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : undefined,
      anthropicApiKey: typeof parsed.anthropicApiKey === 'string' ? parsed.anthropicApiKey : undefined,
      openaiApiKey: typeof parsed.openaiApiKey === 'string' ? parsed.openaiApiKey : undefined
    };
  } catch {
    return {};
  }
}

export async function writeApiKeysToDisk(config: ApiKeyConfig): Promise<void> {
  const filePath = getApiKeysPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  try {
    await fs.chmod(filePath, 0o600);
  } catch {}
}

export function getProvidersPath(): string {
  return path.join(app.getPath('userData'), 'providers.json');
}

export function sanitizeProviderEntry(raw: unknown): ProviderEntry | null {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const kind = raw.kind === 'gemini' || raw.kind === 'anthropic' || raw.kind === 'openai-compatible' ? raw.kind : null;
  if (!isValidProviderId(id) || !label || !kind) return null;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  if (kind === 'openai-compatible' && !/^https?:\/\//.test(baseUrl)) return null;
  return {
    id,
    label,
    kind,
    ...(baseUrl ? { baseUrl } : {}),
    ...(typeof raw.apiKey === 'string' && raw.apiKey ? { apiKey: raw.apiKey } : {}),
    ...(raw.builtIn === true ? { builtIn: true } : {})
  };
}

export function withBuiltInProviders(entries: ProviderEntry[]): ProviderEntry[] {
  const builtIns = builtInProviderEntries();
  const result: ProviderEntry[] = [];
  for (const builtIn of builtIns) {
    const existing = entries.find(entry => entry.id === builtIn.id);
    result.push(existing ? { ...builtIn, ...existing, builtIn: true, kind: builtIn.kind, baseUrl: builtIn.baseUrl } : builtIn);
  }
  for (const entry of entries) {
    if (!builtIns.some(builtIn => builtIn.id === entry.id)) {
      result.push({ ...entry, builtIn: false });
    }
  }
  return result;
}

export async function readProvidersFromDisk(): Promise<ProviderEntry[]> {
  try {
    const content = await fs.readFile(getProvidersPath(), 'utf-8');
    const parsed = JSON.parse(content);
    const rawEntries = isPlainObject(parsed) && Array.isArray(parsed.providers) ? parsed.providers : [];
    const entries = rawEntries
      .map(sanitizeProviderEntry)
      .filter((entry): entry is ProviderEntry => entry !== null);
    return withBuiltInProviders(entries);
  } catch {
    const legacyKeys = await readApiKeysFromDisk();
    const seeded = builtInProviderEntries(legacyKeys);
    await writeProvidersToDisk(seeded);
    return seeded;
  }
}

export async function writeProvidersToDisk(providers: ProviderEntry[]): Promise<void> {
  const filePath = getProvidersPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ providers }, null, 2), 'utf-8');
  try {
    await fs.chmod(filePath, 0o600);
  } catch {}
}

export async function applyApiKeysToEnvironment(): Promise<ApiKeyConfig> {
  const providers = await readProvidersFromDisk();
  const keys: ApiKeyConfig = {
    geminiApiKey: providers.find(p => p.id === 'gemini')?.apiKey,
    anthropicApiKey: providers.find(p => p.id === 'anthropic')?.apiKey,
    openaiApiKey: providers.find(p => p.id === 'openai')?.apiKey
  };
  if (keys.geminiApiKey) process.env.GEMINI_API_KEY = keys.geminiApiKey;
  if (keys.anthropicApiKey) process.env.ANTHROPIC_API_KEY = keys.anthropicApiKey;
  if (keys.openaiApiKey) process.env.OPENAI_API_KEY = keys.openaiApiKey;
  return keys;
}

export function isDangerousAgentAllowed(projectRoot: string): Promise<boolean> {
  return readProjectConfigFromDisk(projectRoot)
    .then((projectConfig) => projectConfig.allowDangerousCli)
    .catch(() => false);
}

export function extractMarkdownHeading(content: string): string | undefined {
  const heading = content
    .split('\n')
    .map(line => line.trim())
    .find(line => /^#{1,3}\s+\S/.test(line));
  return heading?.replace(/^#{1,3}\s+/, '').trim().slice(0, 100);
}
