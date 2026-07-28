export const IPC_LIMITS = {
  roomFileBytes: 2 * 1024 * 1024,
  contextFileBytes: 1024 * 1024,
  skillFileBytes: 512 * 1024,
  agentPayloadBytes: 1024 * 1024,
  teamPayloadBytes: 4 * 1024 * 1024,
  runTextBytes: 128 * 1024,
  runParticipants: 32,
  contextReferences: 100
} as const;

export function assertUtf8Bytes(
  value: unknown,
  label: string,
  maxBytes: number
): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  if (Buffer.byteLength(value, 'utf-8') > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
  }
}

export function assertJsonBytes(value: unknown, label: string, maxBytes: number): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-serializable.`);
  }
  if (Buffer.byteLength(serialized, 'utf-8') > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
  }
}

export function assertStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxItemBytes = 1024
): asserts value is string[] {
  if (
    !Array.isArray(value)
    || value.length > maxItems
    || !value.every(item => (
      typeof item === 'string'
      && Buffer.byteLength(item, 'utf-8') <= maxItemBytes
    ))
  ) {
    throw new Error(`${label} exceeds its item or byte limit.`);
  }
}
