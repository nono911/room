import type {
  Provider,
  ProviderConfig,
  ProviderExecuteOptions
} from './provider.js';

export interface LocalCliConfig extends ProviderConfig {
  command?: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'kiro' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: 'safe' | 'dangerous';
  cwd?: string;
  roomRoot: string;
  timeoutMs?: number;
}

const DISABLED_MESSAGE = 'Local CLI execution is disabled until ROOM can enforce OS-level Source confinement.';

export class LocalCliProvider implements Provider {
  name = 'Local CLI';

  constructor(_config: LocalCliConfig) {
    throw new Error(DISABLED_MESSAGE);
  }

  async execute(
    _prompt: string,
    _systemInstruction?: string,
    _options?: ProviderExecuteOptions
  ): Promise<string> {
    throw new Error(DISABLED_MESSAGE);
  }
}
