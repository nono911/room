import type { AgentConfig } from './registry.js';

export interface LocalCliExecutionPolicy {
  isLocalCli: boolean;
  requiresDangerousWorkspace: boolean;
  reason?: string;
  blockedReason?: string;
}

const DEFAULT_MODEL_SENTINELS = new Set(['', 'default']);
export const VERIFIED_SAFE_LOCAL_CLI_PRESETS = new Set<string>();

export function normalizeLocalCliModelName(modelName?: string): string | undefined {
  const normalized = (modelName || '').trim();
  return DEFAULT_MODEL_SENTINELS.has(normalized.toLowerCase()) ? undefined : normalized;
}

export function getLocalCliExecutionPolicy(agent: Pick<AgentConfig, 'provider' | 'cliPreset' | 'permissionMode'>): LocalCliExecutionPolicy {
  if (agent.provider !== 'Local CLI') {
    return { isLocalCli: false, requiresDangerousWorkspace: false };
  }

  return {
    isLocalCli: true,
    requiresDangerousWorkspace: false,
    blockedReason: 'Local CLI execution is disabled until ROOM can enforce an OS-level Source boundary for both reads and writes.'
  };
}

export function assertLocalCliExecutionAllowed(
  agent: Pick<AgentConfig, 'name' | 'provider' | 'cliPreset' | 'permissionMode'>
): void {
  const policy = getLocalCliExecutionPolicy(agent);
  if (policy.blockedReason) {
    throw new Error(`${policy.blockedReason} Agent "${agent.name}" cannot run.`);
  }
  if (!policy.requiresDangerousWorkspace) {
    return;
  }
}
