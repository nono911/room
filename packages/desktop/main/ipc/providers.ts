import { ipcMain } from 'electron';
import { isValidProviderId, normalizeProviderId, isOpenAiModelAllowed, getFallbackModels, type ProviderEntry } from '@room/engine';
import {
  readProvidersFromDisk, writeProvidersToDisk, applyApiKeysToEnvironment
} from './provider-store.js';

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

async function fetchProviderModels(entry: ProviderEntry): Promise<
  { ok: true; models: { value: string; label: string }[] } | { ok: false; status?: number; error: string }
> {
  try {
    if (entry.kind === 'gemini') {
      if (!entry.apiKey) return { ok: false, error: 'Gemini API key is not configured.' };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${entry.apiKey}`);
      if (!res.ok) return { ok: false, status: res.status, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
      const data: any = await res.json();
      return {
        ok: true,
        models: (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => ({ value: m.name.replace('models/', ''), label: m.displayName || m.name }))
      };
    }
    if (entry.kind === 'anthropic') {
      if (!entry.apiKey) return { ok: false, error: 'Anthropic API key is not configured.' };
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': entry.apiKey, 'anthropic-version': '2023-06-01' }
      });
      if (!res.ok) return { ok: false, status: res.status, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
      const data: any = await res.json();
      return { ok: true, models: (data.data || []).map((m: any) => ({ value: m.id, label: m.display_name || m.id })) };
    }
    const headers: Record<string, string> = {};
    if (entry.apiKey) headers['Authorization'] = `Bearer ${entry.apiKey}`;
    const base = (entry.baseUrl || '').replace(/\/+$/, '');
    const res = await fetch(`${base}/models`, { headers });
    if (!res.ok) return { ok: false, status: res.status, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
    const data: any = await res.json();
    const models = (data.data || [])
      .filter((m: any) => m.id && (entry.id !== 'openai' || isOpenAiModelAllowed(m.id)))
      .map((m: any) => ({ value: m.id, label: m.id }));
    return { ok: true, models };
  } catch (error: any) {
    return { ok: false, error: `${entry.label}: ${error.message}` };
  }
}

async function probeChatCompletion(entry: ProviderEntry): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (entry.apiKey) headers['Authorization'] = `Bearer ${entry.apiKey}`;
    const base = (entry.baseUrl || '').replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    });
    // 400 (unknown model) still proves the endpoint speaks OpenAI-compatible; 401/403/404 do not.
    if (res.ok || res.status === 400) return { ok: true };
    return { ok: false, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
  } catch (error: any) {
    return { ok: false, error: `${entry.label}: ${error.message}` };
  }
}

export function registerProvidersIpc(): void {
  ipcMain.handle('load-providers', async () => {
    try {
      const providers = await readProvidersFromDisk();
      return { success: true, providers: providers.map(maskProvider) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-provider', async (_, payload: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => {
    try {
      const providers = await readProvidersFromDisk();
      const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
      if (!isValidProviderId(id)) {
        return { success: false, error: 'Provider id must be a lowercase slug (a-z, 0-9, dashes).' };
      }
      const existing = providers.find(entry => entry.id === id);
      const label = (payload.label || existing?.label || '').trim();
      const baseUrl = (payload.baseUrl ?? existing?.baseUrl ?? '').trim();
      if (!label) return { success: false, error: 'Provider name is required.' };
      if (existing?.builtIn) {
        // Built-ins: only the key may change.
        if (payload.apiKey === null) delete existing.apiKey;
        else if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) existing.apiKey = payload.apiKey.trim();
      } else {
        if (!/^https?:\/\//.test(baseUrl)) {
          return { success: false, error: 'Base URL must start with http:// or https://.' };
        }
        const entry: ProviderEntry = {
          id,
          label,
          kind: 'openai-compatible',
          baseUrl,
          ...(existing?.apiKey ? { apiKey: existing.apiKey } : {})
        };
        if (payload.apiKey === null) delete entry.apiKey;
        else if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) entry.apiKey = payload.apiKey.trim();
        const index = providers.findIndex(candidate => candidate.id === id);
        if (index >= 0) providers[index] = entry;
        else providers.push(entry);
      }
      await writeProvidersToDisk(providers);
      await applyApiKeysToEnvironment();
      const updated = await readProvidersFromDisk();
      return { success: true, providers: updated.map(maskProvider) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-provider', async (_, providerId: string) => {
    try {
      const providers = await readProvidersFromDisk();
      const entry = providers.find(candidate => candidate.id === providerId);
      if (!entry) return { success: false, error: 'Provider not found.' };
      if (entry.builtIn) return { success: false, error: 'Built-in providers cannot be removed.' };
      const remaining = providers.filter(candidate => candidate.id !== providerId);
      await writeProvidersToDisk(remaining);
      return { success: true, providers: remaining.map(maskProvider) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('test-provider', async (_, providerId: string) => {
    try {
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
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('detect-api-models', async (_, payload: { providerId: string }) => {
    try {
      const providers = await readProvidersFromDisk();
      const id = normalizeProviderId(typeof payload?.providerId === 'string' ? payload.providerId : '');
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
      const id = normalizeProviderId(typeof payload?.providerId === 'string' ? payload.providerId : '');
      const fallbackKey = ({ gemini: 'Gemini', anthropic: 'Claude', openai: 'Codex' } as Record<string, string>)[id];
      if (fallbackKey) {
        return { success: true, models: getFallbackModels(fallbackKey) };
      }
      return { success: true, models: [] };
    }
  });
}
