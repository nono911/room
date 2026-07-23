const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

export function isAllowedExternalUrl(value: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isAllowedRendererNavigation(value: string, isDevelopment: boolean): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'app:' && parsed.hostname === 'localhost') return true;
    return isDevelopment
      && parsed.protocol === 'http:'
      && parsed.hostname === 'localhost'
      && parsed.port === '5173';
  } catch {
    return false;
  }
}
