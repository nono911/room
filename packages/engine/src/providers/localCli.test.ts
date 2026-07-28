import { describe, expect, it } from 'vitest';
import { LocalCliProvider } from './localCli.js';

describe('LocalCliProvider hard cut', () => {
  it('rejects every Local CLI configuration before process execution is possible', () => {
    for (const cliPreset of ['none', 'gemini', 'codex', 'claude', 'kiro'] as const) {
      expect(() => new LocalCliProvider({
        name: 'Local CLI',
        cliPreset,
        roomRoot: '/tmp/room-test'
      })).toThrow('OS-level Source confinement');
    }
  });

  it('keeps execute blocked even when construction is bypassed', async () => {
    const provider = Object.create(LocalCliProvider.prototype) as LocalCliProvider;
    await expect(provider.execute('prompt')).rejects.toThrow('OS-level Source confinement');
  });
});
