const ALLOWED_CHILD_ENV_KEYS = new Set([
  'HOME',
  'LANG',
  'LOGNAME',
  'NO_COLOR',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME'
]);

export function createSanitizedChildEnvironment(
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (ALLOWED_CHILD_ENV_KEYS.has(key) || key.startsWith('LC_')) {
      environment[key] = value;
    }
  }
  return environment;
}
