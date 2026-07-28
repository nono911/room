export function requireStableSourceBirthtime(birthtimeNs: bigint): void {
  if (birthtimeNs <= 0n) {
    throw new Error('The Source filesystem must provide a stable creation identity.');
  }
}
