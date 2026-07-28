const SAFE_LOCAL_CLI_PRESETS = new Set([
  'claude',
  'gemini',
  'codex',
  'codewhale',
  'agy',
  'kiro'
]);

export const isSafeLocalCliPreset = (preset: string): boolean =>
  SAFE_LOCAL_CLI_PRESETS.has(preset);
