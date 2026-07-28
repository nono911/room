import type { TemplateSkill } from '../../../types/domain.js';
import {
  agentPersonaTemplates,
  normalizeProviderId,
  PROVIDER_PRESETS,
  roleTemplateSkills
} from '../../../shared/data/staticData.js';
import { generateTemplateVariants } from './teamVariants.js';

export interface TemplateRowDraft {
  id: string;
  templateName: string;
  count: number;
}

export interface TeamWizardMemberDraft {
  draftId: string;
  templateName: string;
  name: string;
  role: string;
  personaAngle: string;
  provider: string;
  modelName?: string;
  skills: string[];
  basePrompt: string;
  templateSkills: TemplateSkill[];
}

interface ResolvedTemplateSource {
  templateName: string;
  variantName: string;
  role: string;
  provider: string;
  prompt: string;
  skills: TemplateSkill[];
}

export const DEFAULT_TEMPLATE_NAME = agentPersonaTemplates[0]?.name || 'Product';
const GENERIC_FALLBACK_TEMPLATE_NAME = 'Researcher';

const TEMPLATE_ALIASES: Record<string, { baseTemplateName: string; role: string; promptIntro: string }> = {
  Copywriter: {
    baseTemplateName: 'Screenwriter',
    role: 'Copywriter',
    promptIntro: 'You are the Copywriter for this Room. Your job is to draft crisp, audience-aware product, marketing, and interface copy that is easy to use and easy to trust.'
  },
  Support: {
    baseTemplateName: 'Researcher',
    role: 'Support',
    promptIntro: 'You are the Support Specialist for this Room. Your job is to triage user issues, write empathetic troubleshooting guidance, and turn recurring problems into repeatable support playbooks.'
  }
};

export const SUPPLEMENTAL_TEMPLATE_NAMES = Object.keys(TEMPLATE_ALIASES);

function findTemplateByName(templateName: string) {
  return agentPersonaTemplates.find(item => item.name === templateName);
}

function buildAliasedPrompt(promptIntro: string, basePrompt: string): string {
  return `${promptIntro.trim()}\n\n${basePrompt.trim()}`;
}

function resolveTemplateSource(templateName: string): ResolvedTemplateSource | null {
  const exactTemplate = findTemplateByName(templateName);
  if (exactTemplate) {
    return {
      templateName,
      variantName: exactTemplate.name,
      role: exactTemplate.role,
      provider: normalizeProviderId(exactTemplate.provider),
      prompt: exactTemplate.prompt,
      skills: exactTemplate.skills
    };
  }

  const alias = TEMPLATE_ALIASES[templateName];
  if (alias) {
    const baseTemplate = findTemplateByName(alias.baseTemplateName);
    if (!baseTemplate) {
      return null;
    }

    return {
      templateName,
      variantName: templateName,
      role: alias.role,
      provider: normalizeProviderId(baseTemplate.provider),
      prompt: buildAliasedPrompt(alias.promptIntro, baseTemplate.prompt),
      skills: roleTemplateSkills[templateName as keyof typeof roleTemplateSkills] ?? baseTemplate.skills
    };
  }

  const fallbackTemplate = findTemplateByName(GENERIC_FALLBACK_TEMPLATE_NAME);
  if (!fallbackTemplate) {
    return null;
  }

  return {
    templateName,
    variantName: templateName,
    role: templateName,
    provider: normalizeProviderId(fallbackTemplate.provider),
    prompt: buildAliasedPrompt(
      `You are the ${templateName} for this Room. Adapt your output to this role while staying practical, evidence-aware, and useful to the team.`,
      fallbackTemplate.prompt
    ),
    skills: roleTemplateSkills[templateName as keyof typeof roleTemplateSkills] ?? []
  };
}

export function createRowId(): string {
  return globalThis.crypto?.randomUUID?.() || `row-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSystemPrompt(basePrompt: string, personaAngle: string): string {
  return `${basePrompt.trim()}\n\n=== Persona Variant ===\n${personaAngle.trim()}`;
}

export function buildGeneratedDrafts(
  templateRows: TemplateRowDraft[],
  existingNames: string[]
): TeamWizardMemberDraft[] {
  const usedNames = [...existingNames];
  const drafts: TeamWizardMemberDraft[] = [];

  for (const row of templateRows) {
    const template = resolveTemplateSource(row.templateName);
    if (!template) continue;

    const variants = generateTemplateVariants(template.variantName, row.count, usedNames);
    usedNames.push(...variants.map(variant => variant.name));

    variants.forEach((variant, index) => {
      drafts.push({
        draftId: `${row.id}:${index}`,
        templateName: template.templateName,
        name: variant.name,
        role: template.role,
        personaAngle: variant.personaAngle,
        provider: template.provider,
        modelName: undefined,
        skills: template.skills.map(skill => skill.filename),
        basePrompt: template.prompt,
        templateSkills: template.skills
      });
    });
  }

  return drafts;
}

export function buildProviderOptions(): Array<{ id: string; label: string }> {
  const ids = ['gemini', 'anthropic', 'openai', ...PROVIDER_PRESETS.map(provider => provider.id)];
  return Array.from(new Set(ids)).map(id => ({
    id,
    label:
      id === 'anthropic' ? 'Claude / Anthropic' :
      id === 'openai' ? 'OpenAI' :
      id.charAt(0).toUpperCase() + id.slice(1)
  }));
}

export function buildTemplateOptions(): string[] {
  return [...agentPersonaTemplates.map(template => template.name), ...SUPPLEMENTAL_TEMPLATE_NAMES];
}

export function buildSkillDraftContent(skillName: string, templateSkill?: TemplateSkill): string {
  if (templateSkill) {
    return `# ${templateSkill.title}\n\n${templateSkill.content.trim()}\n`;
  }

  const title = skillName
    .replace(/\.md$/i, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Custom Skill';

  return `# ${title}\n\nUse this skill when supporting the team workflow for ${title.toLowerCase()}.\n`;
}

export function mergeDraftEdits(
  previous: TeamWizardMemberDraft[],
  nextDrafts: TeamWizardMemberDraft[]
): TeamWizardMemberDraft[] {
  return nextDrafts.map(nextDraft => {
    const previousDraft = previous.find(item => item.draftId === nextDraft.draftId);
    return previousDraft && previousDraft.templateName === nextDraft.templateName
      ? {
          ...nextDraft,
          name: previousDraft.name,
          role: previousDraft.role,
          personaAngle: previousDraft.personaAngle,
          provider: previousDraft.provider,
          modelName: previousDraft.modelName,
          skills: previousDraft.skills
        }
      : nextDraft;
  });
}
