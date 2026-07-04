export interface TeamMutationFailure {
  error?: string;
  rollbackWarnings?: string[];
}

export function formatTeamMutationError(
  result: TeamMutationFailure,
  fallbackMessage: string
): string {
  const message = result.error || fallbackMessage;
  if (!Array.isArray(result.rollbackWarnings) || result.rollbackWarnings.length === 0) {
    return message;
  }

  return `${message} Cleanup may still be required for: ${result.rollbackWarnings.join(', ')}`;
}
