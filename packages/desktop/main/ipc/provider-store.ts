import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';
import { builtInProviderEntries, isValidProviderId, type ProviderEntry } from '@room/engine';
import { isPlainObject } from './shared.js';

export interface ApiKeyConfig {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
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

async function isLocalServiceRunning(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 800);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export async function readProvidersFromDisk(): Promise<ProviderEntry[]> {
  let entries: ProviderEntry[] = [];
  try {
    const content = await fs.readFile(getProvidersPath(), 'utf-8');
    const parsed = JSON.parse(content);
    const rawEntries = isPlainObject(parsed) && Array.isArray(parsed.providers) ? parsed.providers : [];
    entries = rawEntries
      .map(sanitizeProviderEntry)
      .filter((entry): entry is ProviderEntry => entry !== null);
  } catch {
    const legacyKeys = await readApiKeysFromDisk();
    entries = builtInProviderEntries(legacyKeys);
    await writeProvidersToDisk(entries);
  }

  const baseProviders = withBuiltInProviders(entries);

  // Probe Ollama & LM Studio
  const isOllamaRunning = await isLocalServiceRunning('http://localhost:11434/v1/models');
  const isLMStudioRunning = await isLocalServiceRunning('http://localhost:1234/v1/models');

  if (isOllamaRunning && !baseProviders.some(p => p.id === 'ollama')) {
    baseProviders.push({
      id: 'ollama',
      label: 'Ollama (local)',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1'
    });
  }
  if (isLMStudioRunning && !baseProviders.some(p => p.id === 'lmstudio')) {
    baseProviders.push({
      id: 'lmstudio',
      label: 'LM Studio (local)',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:1234/v1'
    });
  }

  return baseProviders;
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
