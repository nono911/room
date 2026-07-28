import * as path from 'path';
import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { createHash, randomUUID } from 'crypto';
import {
  builtInProviderEntries,
  ensureRoomSystemDirectory,
  isValidProviderId,
  withRoomDataLock,
  type ProviderEntry
} from '@room/engine';
import { isPlainObject } from './shared.js';

export interface ApiKeyConfig {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

const SECURITY_REVISION = /^[a-f0-9]{32}$/;

async function getSystemFilePath(
  filename: string,
  roomHome?: string
): Promise<string> {
  if (!/^[a-z0-9-]+\.json$/.test(filename)) {
    throw new Error('Invalid ROOM system filename.');
  }
  const filePath = path.join(await ensureRoomSystemDirectory(roomHome), filename);
  const stat = await fs.lstat(filePath).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (stat?.isSymbolicLink() || (stat && !stat.isFile())) {
    throw new Error('ROOM system files must be real files.');
  }
  return filePath;
}

async function writeSystemFileAtomically(
  filename: string,
  content: string,
  roomHome?: string
): Promise<void> {
  const filePath = await getSystemFilePath(filename, roomHome);
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  );
  await fs.writeFile(temporaryPath, content, {
    encoding: 'utf-8',
    mode: 0o600,
    flag: 'wx'
  });
  try {
    await getSystemFilePath(filename, roomHome);
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readSystemFile(
  filename: string,
  maxBytes: number,
  roomHome?: string
): Promise<string> {
  const filePath = await getSystemFilePath(filename, roomHome);
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error('ROOM system file exceeds its read limit.');
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total <= maxBytes) {
      const { bytesRead } = await handle.read(
        buffer, total, Math.min(64 * 1024, maxBytes + 1 - total), total
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error('ROOM system file exceeds its read limit.');
    return buffer.subarray(0, total).toString('utf-8');
  } finally {
    await handle.close();
  }
}

export async function readApiKeysFromDisk(roomHome?: string): Promise<ApiKeyConfig> {
  try {
    const content = await readSystemFile('api-keys.json', 64 * 1024, roomHome);
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

export async function writeApiKeysToDisk(
  config: ApiKeyConfig,
  roomHome?: string
): Promise<void> {
  await writeSystemFileAtomically(
    'api-keys.json',
    JSON.stringify(config, null, 2),
    roomHome
  );
}

export function sanitizeProviderEntry(raw: unknown): ProviderEntry | null {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const kind = raw.kind === 'gemini' || raw.kind === 'anthropic' || raw.kind === 'openai-compatible' ? raw.kind : null;
  if (!isValidProviderId(id) || !label || !kind) return null;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  if (kind === 'openai-compatible' && !/^https?:\/\//.test(baseUrl)) return null;
  const apiKey = typeof raw.apiKey === 'string' && raw.apiKey ? raw.apiKey : '';
  return {
    id,
    label,
    kind,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(raw.builtIn === true ? { builtIn: true } : {}),
    // Registries written before revisions existed have none. Deriving one from
    // the entry's material config keeps it stable across reads — minting a
    // fresh token per read would re-prompt every machine-skill grant forever —
    // while still rotating whenever the endpoint or credential changes.
    securityRevision: typeof raw.securityRevision === 'string'
      && SECURITY_REVISION.test(raw.securityRevision)
      ? raw.securityRevision
      : derivedProviderRevision(id, kind, baseUrl, apiKey)
  };
}

export function withBuiltInProviders(entries: ProviderEntry[]): ProviderEntry[] {
  const builtIns = builtInProviderEntries();
  const result: ProviderEntry[] = [];
  for (const builtIn of builtIns) {
    const existing = entries.find(entry => entry.id === builtIn.id);
    result.push(ensureProviderSecurityRevision(existing
      ? { ...builtIn, ...existing, builtIn: true, kind: builtIn.kind, baseUrl: builtIn.baseUrl }
      : builtIn));
  }
  for (const entry of entries) {
    if (!builtIns.some(builtIn => builtIn.id === entry.id)) {
      result.push(ensureProviderSecurityRevision({ ...entry, builtIn: false }));
    }
  }
  return result;
}

// Local services ROOM probes for. Their configuration is fixed, so their
// security revision is derived deterministically instead of being persisted —
// approval and execution must resolve the same value for the same provider.
const DISCOVERABLE_LOCAL_PROVIDERS: ReadonlyArray<{
  entry: ProviderEntry;
  probeUrl: string;
}> = [
  {
    entry: {
      id: 'ollama',
      label: 'Ollama (local)',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      securityRevision: discoveredProviderRevision('ollama')
    },
    probeUrl: 'http://localhost:11434/v1/models'
  },
  {
    entry: {
      id: 'lmstudio',
      label: 'LM Studio (local)',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:1234/v1',
      securityRevision: discoveredProviderRevision('lmstudio')
    },
    probeUrl: 'http://localhost:1234/v1/models'
  }
];

export function discoveredLocalProviderEntry(providerId: string): ProviderEntry | null {
  const discoverable = DISCOVERABLE_LOCAL_PROVIDERS
    .find(candidate => candidate.entry.id === providerId);
  return discoverable ? { ...discoverable.entry } : null;
}

async function isLocalServiceRunning(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 800);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function readProvidersFromDisk(
  roomHome?: string,
  discoverLocal = true
): Promise<ProviderEntry[]> {
  let entries = await readPersistedProviders(roomHome);
  if (!entries) {
    const legacyKeys = await readApiKeysFromDisk(roomHome);
    entries = await publishInitialProviders(builtInProviderEntries(legacyKeys), roomHome);
  }

  const baseProviders = withBuiltInProviders(entries);
  if (baseProviders.length !== entries.length) {
    throw new Error('ROOM provider registry is incomplete.');
  }
  if (!discoverLocal) return baseProviders;

  const running = await Promise.all(DISCOVERABLE_LOCAL_PROVIDERS
    .map(candidate => isLocalServiceRunning(candidate.probeUrl)));
  DISCOVERABLE_LOCAL_PROVIDERS.forEach((candidate, index) => {
    // A persisted entry for the same id stays authoritative.
    if (running[index] && !baseProviders.some(p => p.id === candidate.entry.id)) {
      baseProviders.push({ ...candidate.entry });
    }
  });

  return baseProviders;
}

async function readPersistedProviders(roomHome?: string): Promise<ProviderEntry[] | null> {
  let content: string;
  try {
    content = await readSystemFile('providers.json', 2 * 1024 * 1024, roomHome);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
  const parsed = JSON.parse(content);
  const rawEntries = isPlainObject(parsed) && Array.isArray(parsed.providers) ? parsed.providers : [];
  const entries = rawEntries.slice(0, 100)
    .map(sanitizeProviderEntry)
    .filter((entry): entry is ProviderEntry => entry !== null);
  if (rawEntries.length !== entries.length) {
    throw new Error('ROOM provider registry is invalid.');
  }
  return entries;
}

async function publishInitialProviders(
  providers: ProviderEntry[],
  roomHome?: string
): Promise<ProviderEntry[]> {
  const filePath = await getSystemFilePath('providers.json', roomHome);
  const temporaryPath = path.join(path.dirname(filePath), `.providers.${randomUUID()}.tmp`);
  const initialized = providers.map(ensureProviderSecurityRevision);
  await fs.writeFile(temporaryPath, JSON.stringify({ providers: initialized }, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
    flag: 'wx'
  });
  try {
    await fs.link(temporaryPath, filePath);
    return initialized;
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
    const winner = await readPersistedProviders(roomHome);
    if (!winner) throw new Error('ROOM provider registry initialization was lost.');
    return winner;
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export async function writeProvidersToDisk(
  providers: ProviderEntry[],
  roomHome?: string
): Promise<void> {
  if (providers.length > 100) throw new Error('ROOM supports at most 100 provider entries.');
  await writeSystemFileAtomically(
    'providers.json',
    JSON.stringify({ providers: providers.map(ensureProviderSecurityRevision) }, null, 2),
    roomHome
  );
}

export async function readProviderSecurityRevision(
  providerId: string,
  roomHome?: string
): Promise<string> {
  const provider = (await readProvidersFromDisk(roomHome, false))
    .find(entry => entry.id === providerId)
    ?? discoveredLocalProviderEntry(providerId);
  if (!provider?.securityRevision) {
    throw new Error(`Provider ${providerId} is not configured.`);
  }
  return provider.securityRevision;
}

export function newProviderSecurityRevision(): string {
  return randomUUID().replace(/-/g, '');
}

export async function withProviderStoreMutation<T>(
  operation: () => Promise<T>,
  roomHome?: string
): Promise<T> {
  const systemRoot = await ensureRoomSystemDirectory(roomHome);
  return withRoomDataLock(systemRoot, 'providers', operation);
}

function ensureProviderSecurityRevision(entry: ProviderEntry): ProviderEntry {
  return SECURITY_REVISION.test(entry.securityRevision || '')
    ? entry
    : { ...entry, securityRevision: newProviderSecurityRevision() };
}

function derivedProviderRevision(
  id: string,
  kind: string,
  baseUrl: string,
  apiKey: string
): string {
  return createHash('sha256')
    .update(`room-legacy-provider:v1:${id}:${kind}:${baseUrl}:${apiKey}`)
    .digest('hex')
    .slice(0, 32);
}

function discoveredProviderRevision(providerId: string): string {
  return createHash('sha256')
    .update(`room-discovered-provider:${providerId}:v1`)
    .digest('hex')
    .slice(0, 32);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
