const PUBLIC_ERROR_BYTES = 512;

function boundedMessage(message: string): string {
  if (Buffer.byteLength(message, 'utf-8') <= PUBLIC_ERROR_BYTES) return message;
  return 'ROOM could not complete the request.';
}

export function toPublicError(
  error: unknown,
  fallback = 'ROOM could not complete the request.'
): string {
  console.error('ROOM operation failed:', error);
  const message = error instanceof Error ? error.message : String(error);
  if (/storage quota exceeded/i.test(message)) return 'ROOM storage quota exceeded.';
  if (/already active/i.test(message)) return 'That ROOM operation is already active.';
  if (/active AI run limit/i.test(message)) return 'ROOM is at its active AI run limit.';
  if (/native approval|requires .*approval/i.test(message)) {
    return 'Machine skill approval is required.';
  }
  if (/not attached|selected Source .*unavailable/i.test(message)) {
    return 'The selected Source is no longer attached.';
  }
  if (/attach a Source/i.test(message)) return 'Attach a Source to use Source tools.';
  if (/not found|is unavailable|no .* available/i.test(message)) {
    return 'The requested ROOM item is unavailable.';
  }
  if (/exceeds .*limit|too many|too large|read limit/i.test(message)) {
    return 'The request exceeds a ROOM safety limit.';
  }
  if (/^invalid\b/i.test(message)) return 'Invalid request.';
  return boundedMessage(fallback);
}
