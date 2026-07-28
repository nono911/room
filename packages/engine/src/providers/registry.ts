import { Provider } from './provider.js';
import { GeminiProvider } from './gemini.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';

export type ProviderKind = 'gemini' | 'anthropic' | 'openai-compatible';

export interface ProviderEntry {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  builtIn?: boolean;
  securityRevision?: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  kind: 'openai-compatible';
  baseUrl: string;
  keyless?: boolean;
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

const LEGACY_PROVIDER_IDS: Record<string, string> = {
  Gemini: 'gemini',
  Claude: 'anthropic',
  Codex: 'openai'
};

export function normalizeProviderId(value: string): string {
  return LEGACY_PROVIDER_IDS[value] || value;
}

export function isValidProviderId(value: string): boolean {
  return PROVIDER_ID_PATTERN.test(value);
}

export function builtInProviderEntries(keys: {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
} = {}): ProviderEntry[] {
  return [
    { id: 'gemini', label: 'Gemini (Google)', kind: 'gemini', builtIn: true, ...(keys.geminiApiKey ? { apiKey: keys.geminiApiKey } : {}) },
    { id: 'anthropic', label: 'Claude (Anthropic)', kind: 'anthropic', builtIn: true, ...(keys.anthropicApiKey ? { apiKey: keys.anthropicApiKey } : {}) },
    { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', builtIn: true, ...(keys.openaiApiKey ? { apiKey: keys.openaiApiKey } : {}) }
  ];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'groq', label: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'mistral', label: 'Mistral', kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai-compatible', baseUrl: 'https://api.x.ai/v1' },
  { id: 'together', label: 'Together AI', kind: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'ollama', label: 'Ollama (local)', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (local)', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', keyless: true }
];

export function createApiProvider(entry: ProviderEntry, modelName?: string): Provider {
  switch (entry.kind) {
    case 'gemini':
      return new GeminiProvider({ apiKey: entry.apiKey, modelName });
    case 'anthropic':
      return new ClaudeProvider({ apiKey: entry.apiKey, modelName });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        baseUrl: entry.baseUrl || '',
        apiKey: entry.apiKey,
        modelName,
        providerLabel: entry.label
      });
  }
}

export function resolveApiProvider(
  registry: ProviderEntry[] | undefined,
  providerName: string,
  modelName?: string
): Provider {
  const id = normalizeProviderId(providerName);
  const entry = registry?.find(candidate => candidate.id === id);
  if (entry) {
    return createApiProvider(entry, modelName);
  }
  if (registry !== undefined) {
    throw new Error(`Provider ${id} is not configured.`);
  }
  if (id === 'anthropic') {
    return new ClaudeProvider({ modelName });
  }
  if (id === 'openai') {
    return new CodexProvider({ modelName });
  }
  return new GeminiProvider({ modelName });
}
