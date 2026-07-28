const PROVIDER_TIMEOUT_MS = 120_000;
const PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function fetchProviderJson(
  input: string,
  init: RequestInit
): Promise<{ response: Response; data: unknown; raw: string }> {
  const response = await fetch(input, {
    ...init,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });
  const reader = response.body?.getReader();
  if (!reader) {
    let data: unknown;
    let raw: string;
    if (typeof response.text === 'function') {
      raw = await response.text();
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
    } else if (typeof response.json === 'function') {
      data = await response.json();
      raw = JSON.stringify(data);
    } else {
      throw new Error('Provider returned an unreadable response.');
    }
    if (Buffer.byteLength(raw, 'utf-8') > PROVIDER_RESPONSE_BYTES) {
      throw new Error('Provider response exceeds the 2 MiB limit.');
    }
    return { response, data, raw };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Provider response exceeds the 2 MiB limit.');
    }
    chunks.push(next.value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(combined);
  let data: unknown = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Provider returned invalid JSON.');
    }
  }
  return { response, data, raw };
}
