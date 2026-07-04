import type { TemplateSkill } from '../../../types/domain.js';
import {
  agentPersonaTemplates,
  normalizeProviderId,
  PROVIDER_PRESETS
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

export const DEFAULT_TEMPLATE_NAME = agentPersonaTemplates[0]?.name || 'Product';

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
    const template = agentPersonaTemplates.find(item => item.name === row.templateName);
    if (!template) continue;

    const variants = generateTemplateVariants(template.name, row.count, usedNames);
    usedNames.push(...variants.map(variant => variant.name));

    variants.forEach((variant, index) => {
      drafts.push({
        draftId: `${row.id}:${index}`,
        templateName: template.name,
        name: variant.name,
        role: template.role,
        personaAngle: variant.personaAngle,
        provider: normalizeProviderId(template.provider),
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
  const ids = ['gemini', 'anthropic', 'openai', ...PROVIDER_PRESETS.map(provider => provider.id), 'Local CLI'];
  return Array.from(new Set(ids)).map(id => ({
    id,
    label:
      id === 'anthropic' ? 'Claude / Anthropic' :
      id === 'openai' ? 'OpenAI' :
      id === 'Local CLI' ? 'Local CLI' :
      id.charAt(0).toUpperCase() + id.slice(1)
  }));
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
