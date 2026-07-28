// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  readProvidersFromDisk,
  withProviderStoreMutation,
  writeProvidersToDisk
} from '../../main/ipc/provider-store.js';

describe('provider store mutation lock', () => {
  it('serializes provider revisions across concurrent mutations', async () => {
    const roomHome = await fs.mkdtemp(path.join(os.tmpdir(), 'room-provider-lock-'));
    let releaseFirst = (): void => {};
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let signalFirst = (): void => {};
    const firstEntered = new Promise<void>(resolve => {
      signalFirst = resolve;
    });
    const order: string[] = [];
    try {
      const first = withProviderStoreMutation(async () => {
        order.push('first');
        signalFirst();
        await firstGate;
      }, roomHome);
      await firstEntered;
      const second = withProviderStoreMutation(async () => {
        order.push('second');
      }, roomHome);
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(order).toEqual(['first']);
      releaseFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(['first', 'second']);
    } finally {
      releaseFirst();
      await fs.rm(roomHome, { recursive: true, force: true });
    }
  });

  it('does not let concurrent first-run initialization overwrite a saved provider', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-provider-init-'));
    try {
      for (let index = 0; index < 20; index += 1) {
        const roomHome = path.join(root, `home-${index}`);
        const initialization = readProvidersFromDisk(roomHome, false);
        const save = withProviderStoreMutation(async () => {
          const providers = await readProvidersFromDisk(roomHome, false);
          await writeProvidersToDisk([
            ...providers,
            {
              id: 'custom',
              label: 'Custom',
              kind: 'openai-compatible',
              baseUrl: 'https://example.test/v1'
            }
          ], roomHome);
        }, roomHome);
        await Promise.all([initialization, save]);
        expect((await readProvidersFromDisk(roomHome, false)).some(provider =>
          provider.id === 'custom'
        )).toBe(true);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
