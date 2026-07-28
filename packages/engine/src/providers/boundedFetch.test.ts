import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProviderJson } from './boundedFetch.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bounded provider fetch', () => {
  it('attaches a finite timeout signal to provider requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: 'ok' })
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchProviderJson('https://provider.example/test', { method: 'POST' });

    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('cancels a streaming response after the response byte limit', async () => {
    const oversized = new Uint8Array(1024 * 1024 + 1);
    const cancel = vi.fn();
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => (
            reads++ < 2
              ? { done: false, value: oversized }
              : { done: true, value: undefined }
          ),
          cancel
        })
      }
    }));

    await expect(fetchProviderJson('https://provider.example/test', {}))
      .rejects.toThrow('2 MiB limit');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
