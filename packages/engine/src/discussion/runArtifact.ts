export const MAX_RUN_ARTIFACT_BYTES = 8 * 1024 * 1024;

export function assertBoundedRunArtifact(content: string, label: string): string {
  if (Buffer.byteLength(content, 'utf-8') > MAX_RUN_ARTIFACT_BYTES) {
    throw new Error(`${label} exceeds the 8 MiB run artifact limit.`);
  }
  return content;
}

export function serializeBoundedRunArtifact(value: unknown, label: string): string {
  return assertBoundedRunArtifact(JSON.stringify(value, null, 2), label);
}
