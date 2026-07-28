import { describe, it, expect } from 'vitest';
import {
  normalizeProviderId,
  isValidProviderId,
  builtInProviderEntries,
  PROVIDER_PRESETS,
  resolveApiProvider
} from './registry.js';
import { GeminiProvider } from './gemini.js';
import { ClaudeProvider } from './claude.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';

describe('normalizeProviderId', () => {
  it('maps legacy display names to registry ids', () => {
    expect(normalizeProviderId('Gemini')).toBe('gemini');
    expect(normalizeProviderId('Claude')).toBe('anthropic');
    expect(normalizeProviderId('Codex')).toBe('openai');
    expect(normalizeProviderId('groq')).toBe('groq');
  });
});

describe('isValidProviderId', () => {
  it('accepts lowercase slugs and rejects everything else', () => {
    expect(isValidProviderId('groq')).toBe(true);
    expect(isValidProviderId('my-proxy-2')).toBe(true);
    expect(isValidProviderId('My Proxy')).toBe(false);
    expect(isValidProviderId('-bad')).toBe(false);
    expect(isValidProviderId('')).toBe(false);
  });
});

describe('builtInProviderEntries', () => {
  it('creates gemini, anthropic and openai entries with optional keys', () => {
    const entries = builtInProviderEntries({ anthropicApiKey: 'sk-ant' });
    expect(entries.map(e => e.id)).toEqual(['gemini', 'anthropic', 'openai']);
    expect(entries.every(e => e.builtIn)).toBe(true);
    expect(entries.find(e => e.id === 'anthropic')?.apiKey).toBe('sk-ant');
    expect(entries.find(e => e.id === 'openai')?.baseUrl).toBe('https://api.openai.com/v1');
  });
});

describe('PROVIDER_PRESETS', () => {
  it('includes the agreed presets with openai-compatible base URLs', () => {
    const ids = PROVIDER_PRESETS.map(p => p.id);
    for (const id of ['groq', 'openrouter', 'mistral', 'deepseek', 'xai', 'together', 'ollama', 'lmstudio']) {
      expect(ids).toContain(id);
    }
    expect(PROVIDER_PRESETS.every(p => p.kind === 'openai-compatible' && p.baseUrl.startsWith('http'))).toBe(true);
  });
});

describe('resolveApiProvider', () => {
  const registry = [
    ...builtInProviderEntries({}),
    { id: 'groq', label: 'Groq', kind: 'openai-compatible' as const, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk-x' }
  ];

  it('resolves registry entries by id and by legacy name', () => {
    expect(resolveApiProvider(registry, 'groq', 'llama-3.3-70b')).toBeInstanceOf(OpenAICompatibleProvider);
    expect(resolveApiProvider(registry, 'Claude')).toBeInstanceOf(ClaudeProvider);
    expect(resolveApiProvider(registry, 'gemini')).toBeInstanceOf(GeminiProvider);
  });

  it('labels openai-compatible providers with the entry label', () => {
    const provider = resolveApiProvider(registry, 'groq');
    expect(provider.name).toBe('Groq');
  });

  it('fails closed when an authoritative registry no longer contains the provider', () => {
    expect(() => resolveApiProvider(registry, 'deleted-custom-provider'))
      .toThrow('is not configured');
  });

  it('falls back to env-style providers without a registry', () => {
    expect(resolveApiProvider(undefined, 'Claude')).toBeInstanceOf(ClaudeProvider);
    expect(resolveApiProvider(undefined, 'Codex').name).toBe('Codex');
    expect(resolveApiProvider(undefined, 'unknown-id')).toBeInstanceOf(GeminiProvider);
  });
});
