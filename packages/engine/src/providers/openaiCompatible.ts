import { Provider, ProviderExecuteOptions } from './provider.js';
import { fetchProviderJson } from './boundedFetch.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  modelName?: string;
  providerLabel?: string;
}

export function joinBaseUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function normalizeModelName(modelName?: string): string | undefined {
  const normalized = (modelName || '').trim();
  return normalized.toLowerCase() === 'default' ? undefined : normalized || undefined;
}

export class OpenAICompatibleProvider implements Provider {
  name: string;
  private baseUrl: string;
  private apiKey?: string;
  private modelName: string;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerLabel || 'OpenAI';
    const baseUrl = (config.baseUrl || '').trim();
    if (!baseUrl) {
      throw new Error(`${this.name}: baseUrl is required.`);
    }
    this.baseUrl = baseUrl;
    this.apiKey = (config.apiKey || '').trim() || undefined;
    this.modelName = normalizeModelName(config.modelName) || 'gpt-4o';
  }

  async execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    const url = joinBaseUrl(this.baseUrl, '/chat/completions');

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const { response, data } = await fetchProviderJson(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.modelName, messages, temperature: 0.2 })
    });

    if (!response.ok) {
      throw new Error(`${this.name} API call failed with status ${response.status}.`);
    }

    try {
      const parsed = data as { choices?: Array<{ message?: { content?: string } }> };
      const text = parsed.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error(`Empty response from ${this.name} API.`);
      }
      options?.onChunk?.(text);
      return text;
    } catch (err: any) {
      throw new Error(`Failed to parse ${this.name} API response: ${err.message}.`);
    }
  }
}
