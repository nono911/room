import * as fs from 'fs/promises';
import * as path from 'path';
import { normalizeLocalCliModelName } from './localCliPolicy.js';
import { PERSONA_TEMPLATES, DEFAULT_MEMBER_NAMES } from './personaTemplates.js';
import { normalizeProviderId, isValidProviderId } from '../providers/registry.js';

export interface AgentConfig {
  id?: string;
  name: string;
  role: string;
  provider: string;
  modelName?: string;
  systemPrompt: string;
  skills?: string[];
  command?: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: 'safe' | 'dangerous';
  strategy?: string;
  isVirtual?: boolean;
}

const ALLOWED_CLI_PRESETS = ['claude', 'gemini', 'codex', 'copilot', 'codewhale', 'agy', 'none'] as const;
const ALLOWED_PERMISSION_MODES = ['safe', 'dangerous'] as const;
const ALLOWED_STDIN_FORMATS = ['text', 'json'] as const;
const MEMBER_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAllowed<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function sanitizeSkillFileName(skill: unknown): string | null {
  if (typeof skill !== 'string') return null;
  const trimmed = skill.trim();
  if (!trimmed || /[\\/]/.test(trimmed)) return null;
  const safeName = path.basename(trimmed);
  if (!safeName || safeName === '.' || safeName === '..') return null;
  if (!safeName.toLowerCase().endsWith('.md')) return null;
  return safeName;
}

function normalizeMemberId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Invalid member id.');
  }

  const trimmed = value.trim();
  if (!MEMBER_ID_PATTERN.test(trimmed)) {
    throw new Error('Invalid member id.');
  }

  return trimmed;
}

function encodeAgentFileBase(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

async function resolveAgentFilePath(agentsDir: string, agent: AgentConfig): Promise<string> {
  if (agent.id) {
    return path.join(agentsDir, `${agent.id}.json`);
  }

  const legacyFileName = `${agent.name.toLowerCase()}.json`;
  if (!/[\\/]/.test(agent.name)) {
    const legacyFilePath = path.join(agentsDir, legacyFileName);
    try {
      await fs.access(legacyFilePath);
      return legacyFilePath;
    } catch {}
  }

  return path.join(agentsDir, `${encodeAgentFileBase(agent.name)}.json`);
}

export function validateAgentConfig(rawAgent: unknown): { success: true; agent: AgentConfig } | { success: false; error: string } {
  if (!isPlainObject(rawAgent)) {
    return { success: false, error: 'Invalid agent payload.' };
  }

  const name = typeof rawAgent.name === 'string' ? rawAgent.name.trim() : '';
  const role = typeof rawAgent.role === 'string' ? rawAgent.role.trim() : '';
  const provider = typeof rawAgent.provider === 'string' ? rawAgent.provider.trim() : '';
  const systemPrompt = typeof rawAgent.systemPrompt === 'string' ? rawAgent.systemPrompt.trim() : '';
  const modelName = typeof rawAgent.modelName === 'string' ? rawAgent.modelName.trim() : '';
  let id: string | undefined;

  if (!name || !role || !systemPrompt) {
    return { success: false, error: 'Agent name, role and system prompt are required.' };
  }

  try {
    id = normalizeMemberId(rawAgent.id);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid member id.' };
  }

  const normalizedProvider = provider === 'Local CLI' ? provider : normalizeProviderId(provider);
  if (normalizedProvider !== 'Local CLI' && !isValidProviderId(normalizedProvider)) {
    return { success: false, error: 'Invalid provider.' };
  }

  let cliPreset: AgentConfig['cliPreset'];
  let stdinFormat: AgentConfig['stdinFormat'];
  let permissionMode: AgentConfig['permissionMode'];
  let command: string | undefined;

  if (normalizedProvider === 'Local CLI') {
    const rawPreset = typeof rawAgent.cliPreset === 'string' ? rawAgent.cliPreset.trim() : 'none';
    if (!isAllowed(rawPreset, ALLOWED_CLI_PRESETS)) {
      return { success: false, error: 'Invalid Local CLI preset.' };
    }
    cliPreset = rawPreset;

    const rawPermission = typeof rawAgent.permissionMode === 'string' ? rawAgent.permissionMode.trim() : 'safe';
    if (!isAllowed(rawPermission, ALLOWED_PERMISSION_MODES)) {
      return { success: false, error: 'Invalid Local CLI permission mode.' };
    }
    permissionMode = rawPermission;

    if (cliPreset === 'none') {
      const rawCommand = typeof rawAgent.command === 'string' ? rawAgent.command.trim() : '';
      if (!rawCommand) {
        return { success: false, error: 'Local CLI custom command is required when preset is none.' };
      }
      command = rawCommand;
      permissionMode = 'dangerous';
    }

    if (rawAgent.stdinFormat === undefined) {
      stdinFormat = 'text';
    } else if (typeof rawAgent.stdinFormat === 'string' && isAllowed(rawAgent.stdinFormat, ALLOWED_STDIN_FORMATS)) {
      stdinFormat = rawAgent.stdinFormat;
    } else {
      return { success: false, error: 'Invalid stdin format.' };
    }
  }

  const skills = Array.isArray(rawAgent.skills)
    ? rawAgent.skills
        .map(sanitizeSkillFileName)
        .filter((skill): skill is string => typeof skill === 'string')
    : [];

  return {
    success: true,
    agent: {
      id,
      name,
      role,
      provider: normalizedProvider,
      modelName: normalizedProvider === 'Local CLI' ? normalizeLocalCliModelName(modelName) : modelName || undefined,
      systemPrompt,
      skills,
      command,
      cliPreset,
      stdinFormat,
      permissionMode,
      strategy: typeof rawAgent.strategy === 'string' ? rawAgent.strategy.trim() : undefined
    }
  };
}

export async function loadAgents(dirPath: string): Promise<AgentConfig[]> {
  const agentsDir = path.join(dirPath, '.room', 'members');
  const legacyAgentsDir = path.join(dirPath, '.room', 'agents');
  const agents: AgentConfig[] = [];

  const loadFromDir = async (dir: string) => {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          const config = JSON.parse(content);
          const validated = validateAgentConfig(config);
          if (validated.success) {
            agents.push(validated.agent);
          } else {
            console.warn(`Ignored invalid agent config file ${file}: ${validated.error}`);
          }
        } catch (err) {
          console.error(`Error parsing agent config file ${file}:`, err);
        }
      }
    }
  };

  try {
    await loadFromDir(agentsDir);
  } catch {}

  if (agents.length === 0) {
    try {
      await loadFromDir(legacyAgentsDir);
    } catch {}
  }

  // Populate built-in agents as virtual fallbacks if not overridden
  const existingNames = new Set(agents.map(a => a.name.toLowerCase()));
  for (const template of PERSONA_TEMPLATES) {
    if (!existingNames.has(template.name.toLowerCase())) {
      agents.push({
        name: template.name,
        role: template.role,
        provider: template.provider,
        systemPrompt: template.prompt,
        skills: [],
        isVirtual: true
      });
    }
  }

  return agents;
}

export async function saveAgent(dirPath: string, agent: AgentConfig): Promise<void> {
  const validated = validateAgentConfig(agent);
  if (!validated.success) {
    throw new Error(validated.error);
  }

  const agentsDir = path.join(dirPath, '.room', 'members');
  await fs.mkdir(agentsDir, { recursive: true });

  const filePath = await resolveAgentFilePath(agentsDir, validated.agent);
  await fs.writeFile(filePath, JSON.stringify(validated.agent, null, 2), 'utf-8');
}

export async function createDefaultAgents(dirPath: string) {
  const agentsDir = path.join(dirPath, '.room', 'members');
  await fs.mkdir(agentsDir, { recursive: true });

  const defaults: AgentConfig[] = PERSONA_TEMPLATES
    .filter(template => DEFAULT_MEMBER_NAMES.includes(template.name))
    .map(template => ({
      name: template.name,
      role: template.role,
      provider: template.provider,
      systemPrompt: template.prompt
    }));

  for (const agent of defaults) {
    const filePath = path.join(agentsDir, `${agent.name.toLowerCase()}.json`);
    await fs.writeFile(filePath, JSON.stringify(agent, null, 2), 'utf-8');
  }
}
