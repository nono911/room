import { ipcMain } from 'electron';
import {
  fetchProviderJson,
  getFallbackModels,
  isOpenAiModelAllowed,
  isValidProviderId,
  normalizeProviderId,
  type ProviderEntry
} from '@room/engine';
import {
  newProviderSecurityRevision,
  discoveredLocalProviderEntry,
  readProvidersFromDisk,
  withProviderStoreMutation,
  writeProvidersToDisk
} from './provider-store.js';
import { confirmNativeApproval } from './native-approval.js';
import { assertJsonBytes, assertUtf8Bytes, IPC_LIMITS } from './ipc-limits.js';
import { toPublicError } from './public-error.js';

function normalizeProviderBaseUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Base URL must be a valid http:// or https:// URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Base URL must use http:// or https://.');
  }
  if (url.username || url.password) {
    throw new Error('Base URL cannot contain credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('Base URL cannot contain a query string or fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}

function maskProvider(entry: ProviderEntry) {
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    baseUrl: entry.baseUrl,
    builtIn: !!entry.builtIn,
    hasKey: !!entry.apiKey
  };
}

interface ProviderModelValue {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  supportedGenerationMethods?: unknown;
}

function providerModelArray(data: unknown, key: 'models' | 'data'): ProviderModelValue[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.slice(0, 2000).filter(item => item !== null && typeof item === 'object') as ProviderModelValue[]
    : [];
}

function boundedModelText(value: unknown): string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf-8') <= 512
    ? value
    : '';
}

async function fetchProviderModels(entry: ProviderEntry): Promise<
  { ok: true; models: { value: string; label: string }[] } | { ok: false; status?: number; error: string }
> {
  try {
    if (entry.kind === 'gemini') {
      if (!entry.apiKey) return { ok: false, error: 'Gemini API key is not configured.' };
      const { response, data } = await fetchProviderJson(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${entry.apiKey}`,
        {}
      );
      if (!response.ok) {
        return { ok: false, status: response.status, error: `Provider returned HTTP ${response.status}.` };
      }
      return {
        ok: true,
        models: providerModelArray(data, 'models')
          .filter(model => (
            Array.isArray(model.supportedGenerationMethods)
            && model.supportedGenerationMethods.includes('generateContent')
          ))
          .map(model => {
            const name = boundedModelText(model.name);
            return { value: name.replace('models/', ''), label: boundedModelText(model.displayName) || name };
          })
          .filter(model => model.value)
      };
    }
    if (entry.kind === 'anthropic') {
      if (!entry.apiKey) return { ok: false, error: 'Anthropic API key is not configured.' };
      const { response, data } = await fetchProviderJson('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': entry.apiKey, 'anthropic-version': '2023-06-01' }
      });
      if (!response.ok) {
        return { ok: false, status: response.status, error: `Provider returned HTTP ${response.status}.` };
      }
      return {
        ok: true,
        models: providerModelArray(data, 'data')
          .map(model => {
            const id = boundedModelText(model.id);
            return { value: id, label: boundedModelText(model.display_name) || id };
          })
          .filter(model => model.value)
      };
    }
    const headers: Record<string, string> = {};
    if (entry.apiKey) headers['Authorization'] = `Bearer ${entry.apiKey}`;
    const base = (entry.baseUrl || '').replace(/\/+$/, '');
    const { response, data } = await fetchProviderJson(`${base}/models`, { headers });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `Provider returned HTTP ${response.status}.` };
    }
    const models = providerModelArray(data, 'data')
      .map(model => boundedModelText(model.id))
      .filter(id => id && (entry.id !== 'openai' || isOpenAiModelAllowed(id)))
      .map(id => ({ value: id, label: id }));
    return { ok: true, models };
  } catch {
    return { ok: false, error: 'Provider model discovery failed.' };
  }
}

async function probeChatCompletion(entry: ProviderEntry): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (entry.apiKey) headers['Authorization'] = `Bearer ${entry.apiKey}`;
    const base = (entry.baseUrl || '').replace(/\/+$/, '');
    const { response } = await fetchProviderJson(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    });
    // 400 (unknown model) still proves the endpoint speaks OpenAI-compatible; 401/403/404 do not.
    if (response.ok || response.status === 400) return { ok: true };
    return { ok: false, error: `Provider returned HTTP ${response.status}.` };
  } catch {
    return { ok: false, error: 'Provider connectivity test failed.' };
  }
}

export function registerProvidersIpc(): void {
  ipcMain.handle('load-providers', async () => {
    try {
      const providers = await readProvidersFromDisk();
      return { success: true, providers: providers.map(maskProvider) };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('save-provider', async (event, payload: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => {
    try {
      assertJsonBytes(payload, 'Provider payload', IPC_LIMITS.agentPayloadBytes);
      assertUtf8Bytes(payload?.label || '', 'Provider label', 256);
      assertUtf8Bytes(payload?.baseUrl || '', 'Provider base URL', 2048);
      assertUtf8Bytes(payload?.apiKey || '', 'Provider API key', 16 * 1024);
      const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
      if (!isValidProviderId(id)) {
        return { success: false, error: 'Provider id must be a lowercase slug (a-z, 0-9, dashes).' };
      }
      // A running local service is offered to the renderer by discovery but is
      // not persisted, so it must seed its own defaults here or it can never be
      // configured. A persisted entry always wins.
      const snapshot = (await readProvidersFromDisk(undefined, false))
        .find(entry => entry.id === id)
        || discoveredLocalProviderEntry(id) || undefined;
      const proposedLabel = (payload.label || snapshot?.label || '').trim();
      const proposedBaseUrl = (payload.baseUrl ?? snapshot?.baseUrl ?? '').trim();
      if (!proposedLabel) return { success: false, error: 'Provider name is required.' };
      let approvedEndpoint: string | undefined;
      if (!snapshot?.builtIn) {
        const baseUrl = normalizeProviderBaseUrl(proposedBaseUrl);
        const endpointChanged = !snapshot
          || normalizeProviderBaseUrl(snapshot.baseUrl || '') !== baseUrl;
        if (endpointChanged) {
          const approved = await confirmNativeApproval(
            event,
            'Allow custom AI provider endpoint?',
            `${proposedLabel} will send prompts and credentials to ${new URL(baseUrl).origin}.`,
            'Only approve endpoints you trust. Custom endpoints can reach local or private-network services and receive the provider key you enter.'
          );
          if (!approved) {
            return { success: false, error: 'Custom provider endpoint was not approved.' };
          }
          approvedEndpoint = baseUrl;
        }
      }
      return await withProviderStoreMutation(async () => {
        const providers = await readProvidersFromDisk(undefined, false);
        const existing = providers.find(entry => entry.id === id)
          || discoveredLocalProviderEntry(id) || undefined;
        const label = (payload.label || existing?.label || '').trim();
        const rawBaseUrl = (payload.baseUrl ?? existing?.baseUrl ?? '').trim();
        if (!label) return { success: false, error: 'Provider name is required.' };
        if (existing?.builtIn) {
          const previousKey = existing.apiKey;
          if (payload.apiKey === null) delete existing.apiKey;
          else if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) {
            existing.apiKey = payload.apiKey.trim();
          }
          if (previousKey !== existing.apiKey) {
            existing.securityRevision = newProviderSecurityRevision();
          }
        } else {
          const baseUrl = normalizeProviderBaseUrl(rawBaseUrl);
          const endpointChanged = !existing
            || normalizeProviderBaseUrl(existing.baseUrl || '') !== baseUrl;
          if (existing?.securityRevision !== snapshot?.securityRevision) {
            return {
              success: false,
              error: 'Provider changed while the save was pending. Review and save again.'
            };
          }
          if (endpointChanged && approvedEndpoint !== baseUrl) {
            return {
              success: false,
              error: 'Provider endpoint changed while approval was pending. Review and save again.'
            };
          }
          const entry: ProviderEntry = {
            id,
            label,
            kind: 'openai-compatible',
            baseUrl,
            ...(!endpointChanged && existing?.apiKey ? { apiKey: existing.apiKey } : {}),
            securityRevision: existing?.securityRevision || newProviderSecurityRevision()
          };
          if (payload.apiKey === null) delete entry.apiKey;
          else if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) {
            entry.apiKey = payload.apiKey.trim();
          }
          if (endpointChanged || entry.apiKey !== existing?.apiKey) {
            entry.securityRevision = newProviderSecurityRevision();
          }
          const index = providers.findIndex(candidate => candidate.id === id);
          if (index >= 0) providers[index] = entry;
          else providers.push(entry);
        }
        await writeProvidersToDisk(providers);
        const updated = await readProvidersFromDisk(undefined, false);
        return { success: true, providers: updated.map(maskProvider) };
      });
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('delete-provider', async (_, providerId: string) => {
    try {
      assertUtf8Bytes(providerId, 'Provider id', 128);
      return await withProviderStoreMutation(async () => {
        const providers = await readProvidersFromDisk(undefined, false);
        const entry = providers.find(candidate => candidate.id === providerId);
        if (!entry) {
          return discoveredLocalProviderEntry(providerId)
            ? {
              success: false,
              error: 'Detected local providers are removed by stopping the local service.'
            }
            : { success: false, error: 'Provider not found.' };
        }
        if (entry.builtIn) {
          return { success: false, error: 'Built-in providers cannot be removed.' };
        }
        const remaining = providers.filter(candidate => candidate.id !== providerId);
        await writeProvidersToDisk(remaining);
        return { success: true, providers: remaining.map(maskProvider) };
      });
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('test-provider', async (_, providerId: string) => {
    try {
      assertUtf8Bytes(providerId, 'Provider id', 128);
      const providers = await readProvidersFromDisk();
      const entry = providers.find(candidate => candidate.id === providerId);
      if (!entry) return { success: false, error: 'Provider not found.' };
      const result = await fetchProviderModels(entry);
      if (result.ok) return { success: true, message: `OK — ${result.models.length} model(s) visible.` };
      if (result.status === 404 || result.status === 405) {
        const probe = await probeChatCompletion(entry);
        return probe.ok
          ? { success: true, message: 'OK — chat completions endpoint reachable.' }
          : { success: false, error: probe.error };
      }
      return { success: false, error: result.error };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('detect-api-models', async (_, payload: { providerId: string }) => {
    let id = '';
    try {
      assertJsonBytes(payload, 'Provider model request', 1024);
      assertUtf8Bytes(payload?.providerId, 'Provider id', 128);
      const providers = await readProvidersFromDisk();
      id = normalizeProviderId(payload.providerId);
      const entry = providers.find(candidate => candidate.id === id);
      if (!entry) return { success: false, error: 'Unknown provider.' };
      const result = await fetchProviderModels(entry);
      if (result.ok && result.models.length > 0) return { success: true, models: result.models };
      if (result.ok) return { success: true, models: [] };

      const fallbackKey = ({ gemini: 'Gemini', anthropic: 'Claude', openai: 'Codex' } as Record<string, string>)[id];
      if (fallbackKey) {
        return { success: true, models: getFallbackModels(fallbackKey) };
      }
      return { success: true, models: [] };
    } catch (error: any) {
      const fallbackKey = ({ gemini: 'Gemini', anthropic: 'Claude', openai: 'Codex' } as Record<string, string>)[id];
      if (fallbackKey) {
        return { success: true, models: getFallbackModels(fallbackKey) };
      }
      return { success: true, models: [] };
    }
  });
}
