import { describe, expect, it } from 'vitest';
import { LocalCliProvider } from './localCli.js';

describe('LocalCliProvider safe presets', () => {
  it('accepts verified presets in safe mode', () => {
    for (const cliPreset of ['claude', 'gemini', 'codex', 'codewhale', 'agy', 'kiro'] as const) {
      expect(() => new LocalCliProvider({
        name: 'Local CLI',
        cliPreset,
        permissionMode: 'safe',
        roomRoot: '/tmp/room-test'
      })).not.toThrow();
    }
  });

  it('rejects unsupported presets and dangerous mode', () => {
    expect(() => new LocalCliProvider({
      name: 'Local CLI',
      cliPreset: 'copilot',
      roomRoot: '/tmp/room-test'
    })).toThrow('verified preset in safe mode');
    expect(() => new LocalCliProvider({
      name: 'Local CLI',
      cliPreset: 'codex',
      permissionMode: 'dangerous',
      roomRoot: '/tmp/room-test'
    })).toThrow('verified preset in safe mode');
  });
});
