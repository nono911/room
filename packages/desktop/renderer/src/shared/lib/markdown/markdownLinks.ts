const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

export function normalizeSafeMarkdownHref(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || CONTROL_CHARACTER_PATTERN.test(candidate)) return null;

  try {
    const parsed = new URL(candidate);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
