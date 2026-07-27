import type { AgentConfig } from './registry.js';

export interface LocalCliExecutionPolicy {
  isLocalCli: boolean;
  requiresDangerousWorkspace: boolean;
  reason?: string;
}

const DEFAULT_MODEL_SENTINELS = new Set(['', 'default']);

export function normalizeLocalCliModelName(modelName?: string): string | undefined {
  const normalized = (modelName || '').trim();
  return DEFAULT_MODEL_SENTINELS.has(normalized.toLowerCase()) ? undefined : normalized;
}

export function getLocalCliExecutionPolicy(agent: Pick<AgentConfig, 'provider' | 'cliPreset' | 'permissionMode'>): LocalCliExecutionPolicy {
  if (agent.provider !== 'Local CLI') {
    return { isLocalCli: false, requiresDangerousWorkspace: false };
  }

  const cliPreset = agent.cliPreset || 'none';
  if (cliPreset === 'none') {
    return {
      isLocalCli: true,
      requiresDangerousWorkspace: true,
      reason: 'Custom Local CLI commands require dangerous mode because they execute arbitrary commands.'
    };
  }

  if ((agent.permissionMode || 'safe') === 'dangerous') {
    return {
      isLocalCli: true,
      requiresDangerousWorkspace: true,
      reason: 'Dangerous Local CLI permission mode requires Room dangerous mode.'
    };
  }

  return { isLocalCli: true, requiresDangerousWorkspace: false };
}

export function assertLocalCliExecutionAllowed(
  agent: Pick<AgentConfig, 'name' | 'provider' | 'cliPreset' | 'permissionMode'>,
  allowDangerousCli: boolean
): void {
  const policy = getLocalCliExecutionPolicy(agent);
  if (!policy.requiresDangerousWorkspace || allowDangerousCli) {
    return;
  }

  const reason = policy.reason || 'Local CLI execution requires Room dangerous mode.';
  throw new Error(`${reason} Agent "${agent.name}" is not allowed to run until dangerous CLI access is enabled in Room settings.`);
}
