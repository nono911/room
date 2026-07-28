import type { AgentDefaultSelection } from '../useAgentManagement.js';

export type AgentLifecycle = 'temporary' | 'persistent';

export interface AgentInstanceConfig {
  name: string;
  role: string;
  provider: string;
  modelName?: string;
  cliPreset?: string;
  stdinFormat?: 'text' | 'json';
  permissionMode?: 'safe' | 'dangerous';
  systemPrompt: string;
  skills: string[];
}

interface AgentTemplate {
  name: string;
  role: string;
  prompt: string;
}

interface CreateAgentInstancesOptions {
  template: AgentTemplate;
  defaults: AgentDefaultSelection;
  skillFiles: string[];
  existingNames: string[];
  count: number;
}

function normalizeAgentName(value: string): string {
  return value.trim().toLowerCase();
}

function getUniqueAgentName(baseName: string, usedNames: Set<string>): string {
  let index = 1;
  let candidate = `${baseName} ${index}`;
  while (usedNames.has(normalizeAgentName(candidate))) {
    index += 1;
    candidate = `${baseName} ${index}`;
  }
  usedNames.add(normalizeAgentName(candidate));
  return candidate;
}

function buildClonePrompt(template: AgentTemplate, name: string): string {
  return `${template.prompt}

=== Clone Identity ===
You are ${name}, a distinct participant cloned from ${template.name}. Keep the same specialty, but form your own independent judgment. When another clone has already spoken, challenge, refine, or extend their reasoning instead of merely agreeing.`;
}

export function createAgentInstancesFromTemplate({
  template,
  defaults,
  skillFiles,
  existingNames,
  count
}: CreateAgentInstancesOptions): AgentInstanceConfig[] {
  const usedNames = new Set(existingNames.map(normalizeAgentName));
  const safeCount = Math.max(1, Math.min(6, Math.floor(count || 1)));

  return Array.from({ length: safeCount }, () => {
    const name = getUniqueAgentName(template.name, usedNames);
    return {
      name,
      role: template.role,
      provider: defaults.provider,
      modelName: defaults.modelName || undefined,
      cliPreset: defaults.provider === 'Local CLI' ? defaults.cliPreset : undefined,
      stdinFormat: defaults.provider === 'Local CLI' ? 'text' : undefined,
      permissionMode: defaults.provider === 'Local CLI' ? 'safe' : undefined,
      systemPrompt: buildClonePrompt(template, name),
      skills: skillFiles
    };
  });
}
