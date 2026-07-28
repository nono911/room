import {
  isMachineSkillReference,
  validateAgentConfig,
  type AgentConfig
} from '@room/engine';

export function normalizeTemporaryAgents(rawAgents: unknown): AgentConfig[] {
  if (!Array.isArray(rawAgents)) return [];
  const seenIds = new Set<string>();
  return rawAgents
    .slice(0, 12)
    .map((rawAgent): AgentConfig | null => {
      if (!isPlainObject(rawAgent)) return null;
      const id = typeof rawAgent.id === 'string' ? rawAgent.id.trim() : '';
      if (!/^tmp_[a-z0-9][a-z0-9_-]{2,80}$/.test(id) || seenIds.has(id)) {
        return null;
      }
      const candidate = { ...rawAgent };
      delete candidate.id;
      const result = validateAgentConfig(candidate);
      if (!result.success || result.agent.provider === 'Local CLI') return null;
      seenIds.add(id);
      return {
        ...result.agent,
        id,
        skills: (result.agent.skills || []).filter(
          skill => !isMachineSkillReference(skill)
        )
      };
    })
    .filter((agent): agent is AgentConfig => agent !== null);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
