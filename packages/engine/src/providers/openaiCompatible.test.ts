import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider, joinBaseUrl } from './openaiCompatible.js';

const okResponse = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] })
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse('hello'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('joinBaseUrl', () => {
  it('joins paths and tolerates trailing slashes', () => {
    expect(joinBaseUrl('https://api.groq.com/openai/v1', '/chat/completions'))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(joinBaseUrl('https://api.groq.com/openai/v1/', '/chat/completions'))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('requires a baseUrl', () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: '', providerLabel: 'Groq' }))
      .toThrow('Groq: baseUrl is required.');
  });

  it('sends Authorization header only when a key is present', async () => {
    const keyed = new OpenAICompatibleProvider({
      baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'sk-test', modelName: 'llama-3.3-70b', providerLabel: 'Groq'
    });
    await keyed.execute('hi');
    const [, keyedInit] = fetchMock.mock.calls[0];
    expect(keyedInit.headers['Authorization']).toBe('Bearer sk-test');

    const keyless = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1', modelName: 'llama3', providerLabel: 'Ollama'
    });
    await keyless.execute('hi');
    const [, keylessInit] = fetchMock.mock.calls[1];
    expect(keylessInit.headers['Authorization']).toBeUndefined();
  });

  it('calls {baseUrl}/chat/completions with model and messages', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1/', modelName: 'llama3', providerLabel: 'Ollama'
    });
    const result = await provider.execute('prompt text', 'system text');
    expect(result).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const payload = JSON.parse(init.body);
    expect(payload.model).toBe('llama3');
    expect(payload.messages).toEqual([
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'prompt text' }
    ]);
  });

  it('prefixes errors with the provider label', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'sk-bad', modelName: 'llama-3.3-70b', providerLabel: 'Groq'
    });
    await expect(provider.execute('hi')).rejects.toThrow('Groq API call failed with status 401: bad key');
  });

  it('treats modelName "default" as unset and falls back to gpt-4o', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', modelName: 'Default'
    });
    await provider.execute('hi');
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.model).toBe('gpt-4o');
  });
});
