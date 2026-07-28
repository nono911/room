import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from './claude.js';
import { GeminiProvider } from './gemini.js';

const SENTINEL = 'provider-private-body-sentinel';

afterEach(() => {
  vi.unstubAllGlobals();
});

function rejectWithPrivateBody(status: number): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ error: SENTINEL }),
    {
      status,
      headers: { 'Content-Type': 'application/json' }
    }
  )));
}

describe('provider error redaction', () => {
  it('does not expose Gemini response bodies', async () => {
    rejectWithPrivateBody(429);
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const failure = provider.execute('prompt').catch(error => error as Error);
    await expect(failure).resolves.toMatchObject({
      message: 'Gemini API call failed with status 429.'
    });
    await expect(failure).resolves.not.toMatchObject({
      message: expect.stringContaining(SENTINEL)
    });
  });

  it('does not expose Claude response bodies', async () => {
    rejectWithPrivateBody(503);
    const provider = new ClaudeProvider({ apiKey: 'test-key' });

    const failure = provider.execute('prompt').catch(error => error as Error);
    await expect(failure).resolves.toMatchObject({
      message: 'Claude API call failed with status 503.'
    });
    await expect(failure).resolves.not.toMatchObject({
      message: expect.stringContaining(SENTINEL)
    });
  });
});
