export interface ModelOption {
  value: string;
  label: string;
}

export type CliPresetId =
  | 'claude'
  | 'gemini'
  | 'codex'
  | 'copilot'
  | 'codewhale'
  | 'agy';

export const LOCAL_CLI_FALLBACK_MODELS: Record<CliPresetId, ModelOption[]> = {
  claude: [
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { value: 'opus', label: 'Alias: Opus (Claude Code)' },
    { value: 'sonnet', label: 'Alias: Sonnet (Claude Code)' },
    { value: 'haiku', label: 'Alias: Haiku (Claude Code)' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (v2)' },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (Latest)' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (Latest)' }
  ],
  gemini: [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
  ],
  codex: [
    { value: 'default', label: 'Default (CLI config)' },
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.1', label: 'gpt-5.1' },
    { value: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
    { value: 'gpt-5-codex', label: 'gpt-5-codex' },
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'o3', label: 'o3' },
    { value: 'o4-mini', label: 'o4-mini' }
  ],
  copilot: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o-mini' }
  ],
  codewhale: [
    { value: 'deepseek-coder', label: 'DeepSeek Coder' },
    { value: 'deepseek-chat', label: 'DeepSeek Chat' }
  ],
  agy: [
    { value: 'default', label: 'Default (CLI config)' },
    { value: 'Gemini 3.1 Pro (High)', label: 'Gemini 3.1 Pro (High)' },
    { value: 'Gemini 3.1 Pro (Low)', label: 'Gemini 3.1 Pro (Low)' },
    { value: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (High)' },
    { value: 'Gemini 3.5 Flash (Medium)', label: 'Gemini 3.5 Flash (Medium)' },
    { value: 'Gemini 3.5 Flash (Low)', label: 'Gemini 3.5 Flash (Low)' },
    { value: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
    { value: 'Claude Opus 4.6 (Thinking)', label: 'Claude Opus 4.6 (Thinking)' },
    { value: 'GPT-OSS 120B (Medium)', label: 'GPT-OSS 120B (Medium)' }
  ]
};

export type CloudProvider = 'Gemini' | 'Claude' | 'Codex';

export const CLOUD_API_FALLBACK_MODELS: Record<CloudProvider, ModelOption[]> = {
  Gemini: [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Default)' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }
  ],
  Claude: [
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (v2)' },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (Latest)' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (Latest)' }
  ],
  Codex: [
    { value: 'default', label: 'Default (CLI config)' },
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.1', label: 'gpt-5.1' },
    { value: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
    { value: 'gpt-5-codex', label: 'gpt-5-codex' },
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'o3', label: 'o3' },
    { value: 'o4-mini', label: 'o4-mini' }
  ]
};

export const OPENAI_MODEL_ID_PREFIXES = ['gpt', 'o1', 'o3', 'o4'];

export function isOpenAiModelAllowed(modelId: string): boolean {
  return OPENAI_MODEL_ID_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

export function getFallbackModels(cliId: string): ModelOption[] {
  if ((cliId as CliPresetId) in LOCAL_CLI_FALLBACK_MODELS) {
    return LOCAL_CLI_FALLBACK_MODELS[cliId as CliPresetId] || [];
  }

  if ((cliId as CloudProvider) in CLOUD_API_FALLBACK_MODELS) {
    return CLOUD_API_FALLBACK_MODELS[cliId as CloudProvider] || [];
  }

  return [];
}
