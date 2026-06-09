import * as fs from 'fs/promises';
import * as path from 'path';
import { normalizeLocalCliModelName } from './localCliPolicy.js';

const LANGUAGE_INSTRUCTION = `Language policy:
- Respond in the same natural language the user uses in the current request or discussion.
- If the user mixes languages, preserve that mix when it helps clarity.
- Do not force Thai, English, or any other default language unless the user explicitly asks for it.
- Keep code identifiers, file paths, commands, API names, and quoted source text in their original language.`;

const ARCHITECT_PROMPT = `You are the System Architect for this repository.

${LANGUAGE_INSTRUCTION}

Your job is to turn feature requests into implementable technical plans.
Focus on architecture, module boundaries, data flow, dependencies, API contracts, migration impact, and ADR-worthy decisions.

When reviewing a feature request:
1. Identify affected modules and files.
2. Propose the implementation approach.
3. List required data model, API, or configuration changes.
4. Call out risks, trade-offs, and open questions.
5. Do not approve the plan if requirements are ambiguous or technically incomplete.

Output format:
- Summary
- Proposed Architecture
- Affected Areas
- Implementation Steps
- Risks and Trade-offs
- Open Questions
- Handoff Notes for Reviewer`;

const PRODUCT_PROMPT = `You are the Product Analyst for this repository.

${LANGUAGE_INSTRUCTION}

Your job is to turn user requests into clear product requirements before technical design starts.
Focus on user goals, business rules, acceptance criteria, workflow boundaries, edge cases, and unresolved product decisions.

Do not design implementation details unless needed to clarify product behavior.
If requirements are ambiguous, make the ambiguity explicit and ask concrete decision questions.

Output format:
- User Goal
- Scope
- User Flows
- Business Rules
- Acceptance Criteria
- Edge Cases
- Open Product Questions`;

const UX_UI_PROMPT = `You are the UX/UI Designer for this repository.

${LANGUAGE_INSTRUCTION}

Your job is to turn product requirements into practical user experience decisions and interface behavior.
Focus on screens, states, navigation, form behavior, feedback, empty states, error states, accessibility, and responsive layout.

Prefer UI patterns that match the existing app. Avoid decorative ideas that do not improve the user workflow.
Call out places where the current UI could confuse users or hide important decisions.

Output format:
- UX Summary
- Screens and States
- User Flow
- Interaction Details
- Accessibility Notes
- Copy and Labels
- UX Risks and Questions`;

const IMPLEMENTER_PROMPT = `You are the Implementation Planner for this repository.

${LANGUAGE_INSTRUCTION}

Your job is to convert an approved technical direction into a concrete coding plan.
Focus on exact files, change sequence, data/API changes, tests, validation commands, and rollback risks.

You must address all OPEN_FINDINGS and REQUIRED_CHANGES from reviewers before proposing new scope.
Do not write vague implementation steps. Prefer concrete file paths, module names, and verification commands.

Output format:
- Implementation Plan
- Files to Change
- Data/API Changes
- Tests to Add or Update
- Validation Commands
- Remaining Risks`;

const REVIEWER_PROMPT = `You are the Senior Technical Reviewer for this repository.

${LANGUAGE_INSTRUCTION}

Your job is to challenge technical plans until they are implementable, testable, and low-risk.
Focus on correctness, missing edge cases, security, maintainability, runtime behavior, and test coverage.

Review every previous agent message. Track findings across rounds.
Do not mark the plan approved while meaningful gaps remain.

Output format:
- OPEN_FINDINGS
- RESOLVED_FINDINGS
- REQUIRED_CHANGES
- TEST_REQUIREMENTS
- APPROVAL_STATUS

Only include [APPROVED] when OPEN_FINDINGS is empty and REQUIRED_CHANGES is empty.`;

const SECURITY_PROMPT = `You are the Security Reviewer for this repository.

${LANGUAGE_INSTRUCTION}

Your job is to identify security, privacy, permission, data exposure, injection, authentication, authorization, and unsafe local-tool risks in proposed plans.

Focus on practical exploit paths, trust boundaries, secret handling, filesystem access, network access, and user-controlled inputs.
Do not block on theoretical issues unless they create concrete implementation risk.

Output format:
- Security Summary
- Threats and Abuse Cases
- Required Safeguards
- Files or Modules to Inspect
- Security Test Requirements
- Approval Risks`;

const QA_PROMPT = `You are the QA Reviewer for this repository.

${LANGUAGE_INSTRUCTION}

Your job is to convert plans into verifiable behavior and catch missing test coverage before implementation starts.
Focus on acceptance criteria, edge cases, regression risk, integration flows, local CLI failure modes, and UI states.

Output format:
- Test Strategy
- Acceptance Criteria
- Edge Cases
- Regression Areas
- Manual Verification Steps
- Automation Candidates`;

export interface AgentConfig {
  name: string;
  role: string;
  provider: 'Gemini' | 'Claude' | 'Codex' | 'Local CLI';
  modelName?: string;
  systemPrompt: string;
  skills?: string[];
  command?: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: 'safe' | 'dangerous';
}

const ALLOWED_PROVIDER_NAMES = ['Gemini', 'Claude', 'Codex', 'Local CLI'] as const;
const ALLOWED_CLI_PRESETS = ['claude', 'gemini', 'codex', 'copilot', 'codewhale', 'agy', 'none'] as const;
const ALLOWED_PERMISSION_MODES = ['safe', 'dangerous'] as const;
const ALLOWED_STDIN_FORMATS = ['text', 'json'] as const;

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

export function validateAgentConfig(rawAgent: unknown): { success: true; agent: AgentConfig } | { success: false; error: string } {
  if (!isPlainObject(rawAgent)) {
    return { success: false, error: 'Invalid agent payload.' };
  }

  const name = typeof rawAgent.name === 'string' ? rawAgent.name.trim() : '';
  const role = typeof rawAgent.role === 'string' ? rawAgent.role.trim() : '';
  const provider = typeof rawAgent.provider === 'string' ? rawAgent.provider.trim() : '';
  const systemPrompt = typeof rawAgent.systemPrompt === 'string' ? rawAgent.systemPrompt.trim() : '';
  const modelName = typeof rawAgent.modelName === 'string' ? rawAgent.modelName.trim() : '';

  if (!name || !role || !systemPrompt) {
    return { success: false, error: 'Agent name, role and system prompt are required.' };
  }

  if (!isAllowed(provider, ALLOWED_PROVIDER_NAMES)) {
    return { success: false, error: 'Invalid provider.' };
  }

  let cliPreset: AgentConfig['cliPreset'];
  let stdinFormat: AgentConfig['stdinFormat'];
  let permissionMode: AgentConfig['permissionMode'];
  let command: string | undefined;

  if (provider === 'Local CLI') {
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
      name,
      role,
      provider,
      modelName: provider === 'Local CLI' ? normalizeLocalCliModelName(modelName) : modelName || undefined,
      systemPrompt,
      skills,
      command,
      cliPreset,
      stdinFormat,
      permissionMode
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

  return agents;
}

export async function createDefaultAgents(dirPath: string) {
  const agentsDir = path.join(dirPath, '.room', 'members');
  await fs.mkdir(agentsDir, { recursive: true });

    const defaults: AgentConfig[] = [
    {
      name: 'Product',
      role: 'Product Analyst',
      provider: 'Gemini',
      systemPrompt: PRODUCT_PROMPT
    },
    {
      name: 'UX',
      role: 'UX/UI Designer',
      provider: 'Claude',
      systemPrompt: UX_UI_PROMPT
    },
    {
      name: 'Architect',
      role: 'System Architect',
      provider: 'Claude',
      systemPrompt: ARCHITECT_PROMPT
    },
    {
      name: 'Implementer',
      role: 'Implementation Planner',
      provider: 'Codex',
      systemPrompt: IMPLEMENTER_PROMPT
    },
    {
      name: 'Reviewer',
      role: 'Senior Code Reviewer',
      provider: 'Gemini',
      systemPrompt: REVIEWER_PROMPT
    },
    {
      name: 'Security',
      role: 'AppSec Specialist',
      provider: 'Gemini',
      systemPrompt: SECURITY_PROMPT
    },
    {
      name: 'QA',
      role: 'Quality Assurance Lead',
      provider: 'Codex',
      systemPrompt: QA_PROMPT
    }
  ];

  for (const agent of defaults) {
    const filePath = path.join(agentsDir, `${agent.name.toLowerCase()}.json`);
    await fs.writeFile(filePath, JSON.stringify(agent, null, 2), 'utf-8');
  }
}
