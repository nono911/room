// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showMessageBox: vi.fn(),
  readProvidersFromDisk: vi.fn(),
  writeProvidersToDisk: vi.fn(),
  newProviderSecurityRevision: vi.fn(() => 'b'.repeat(32)),
  mutationDepth: 0
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null)
  },
  dialog: {
    showMessageBox: mocks.showMessageBox
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      mocks.handlers.set(channel, handler);
    })
  }
}));

vi.mock('../../main/ipc/provider-store.js', async importOriginal => ({
  // The real discovered-provider table, so these tests bind to the same
  // deterministic entries discovery and grant approval resolve.
  discoveredLocalProviderEntry: (
    await importOriginal<typeof import('../../main/ipc/provider-store.js')>()
  ).discoveredLocalProviderEntry,
  readProvidersFromDisk: mocks.readProvidersFromDisk,
  writeProvidersToDisk: mocks.writeProvidersToDisk,
  newProviderSecurityRevision: mocks.newProviderSecurityRevision,
  withProviderStoreMutation: async (
    operation: () => Promise<unknown>
  ) => {
    mocks.mutationDepth += 1;
    try {
      return await operation();
    } finally {
      mocks.mutationDepth -= 1;
    }
  }
}));

import { registerProvidersIpc } from '../../main/ipc/providers.js';

const storedProvider = {
  id: 'custom',
  label: 'Custom',
  kind: 'openai-compatible' as const,
  baseUrl: 'https://trusted.example/v1',
  apiKey: 'hidden-secret',
  securityRevision: 'a'.repeat(32)
};

describe('provider endpoint authorization', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showMessageBox.mockReset();
    mocks.writeProvidersToDisk.mockReset();
    mocks.mutationDepth = 0;
    mocks.readProvidersFromDisk.mockReset()
      .mockResolvedValueOnce([{ ...storedProvider }])
      .mockResolvedValue([{ ...storedProvider }]);
    registerProvidersIpc();
  });

  it('rejects endpoint retargeting when native approval is denied', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
    const handler = mocks.handlers.get('save-provider');
    const result = await handler?.({ sender: {} }, {
      id: 'custom',
      baseUrl: 'https://attacker.example/v1'
    }) as { success: boolean; error?: string };

    expect(result).toEqual({
      success: false,
      error: 'Custom provider endpoint was not approved.'
    });
    expect(mocks.writeProvidersToDisk).not.toHaveBeenCalled();
  });

  it('clears a hidden key when an approved endpoint identity changes', async () => {
    mocks.showMessageBox.mockImplementation(async () => {
      expect(mocks.mutationDepth).toBe(0);
      return { response: 0 };
    });
    const handler = mocks.handlers.get('save-provider');
    const result = await handler?.({ sender: {} }, {
      id: 'custom',
      baseUrl: 'https://replacement.example/v1'
    }) as { success: boolean };

    expect(result.success).toBe(true);
    const written = mocks.writeProvidersToDisk.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(written[0]).toMatchObject({
      id: 'custom',
      baseUrl: 'https://replacement.example/v1'
    });
    expect(written[0]).not.toHaveProperty('apiKey');
  });

  it('rejects an approved save when the provider changes before commit', async () => {
    mocks.readProvidersFromDisk
      .mockReset()
      .mockResolvedValueOnce([{ ...storedProvider }])
      .mockResolvedValueOnce([{
        ...storedProvider,
        securityRevision: 'c'.repeat(32)
      }]);
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const handler = mocks.handlers.get('save-provider');
    const result = await handler?.({ sender: {} }, {
      id: 'custom',
      baseUrl: 'https://replacement.example/v1'
    }) as { success: boolean; error?: string };

    expect(result).toEqual({
      success: false,
      error: 'Provider changed while the save was pending. Review and save again.'
    });
    expect(mocks.writeProvidersToDisk).not.toHaveBeenCalled();
  });

  it('rotates provider security revision when credentials change', async () => {
    const handler = mocks.handlers.get('save-provider');
    const result = await handler?.({ sender: {} }, {
      id: 'custom',
      apiKey: 'replacement-secret'
    }) as { success: boolean };

    expect(result.success).toBe(true);
    const written = mocks.writeProvidersToDisk.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(written[0]).toMatchObject({
      apiKey: 'replacement-secret',
      securityRevision: 'b'.repeat(32)
    });
  });

  it('stores a key on an auto-discovered local provider without re-approving its endpoint', async () => {
    const handler = mocks.handlers.get('save-provider');
    const result = await handler?.({ sender: {} }, {
      id: 'ollama',
      apiKey: 'local-secret'
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);
    // Its endpoint is the one ROOM itself probes, so no approval prompt.
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
    const written = mocks.writeProvidersToDisk.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(written).toContainEqual(expect.objectContaining({
      id: 'ollama',
      label: 'Ollama (local)',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'local-secret',
      // Adding a credential must invalidate grants bound to the discovered revision.
      securityRevision: 'b'.repeat(32)
    }));
  });

  it('explains that an auto-discovered local provider is not removable', async () => {
    const handler = mocks.handlers.get('delete-provider');
    const result = await handler?.({ sender: {} }, 'ollama') as {
      success: boolean;
      error?: string;
    };

    expect(result).toEqual({
      success: false,
      error: 'Detected local providers are removed by stopping the local service.'
    });
    expect(mocks.writeProvidersToDisk).not.toHaveBeenCalled();
  });

  it('rejects provider URLs containing embedded credentials', async () => {
    const handler = mocks.handlers.get('save-provider');
    const result = await handler?.({ sender: {} }, {
      id: 'custom',
      baseUrl: 'https://user:password@example.com/v1'
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('ROOM could not complete the request.');
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });
});
