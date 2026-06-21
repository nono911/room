import yaml from 'js-yaml';

export interface SkillMetadata {
  name?: string;
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
  triggerKeywords?: string[];
}

export interface ParsedSkill {
  metadata: SkillMetadata;
  content: string;
}

export function parseSkillFrontmatter(fileContent: string): ParsedSkill {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = fileContent.match(frontmatterRegex);

  if (!match) {
    return {
      metadata: {},
      content: fileContent,
    };
  }

  const yamlStr = match[1];
  const content = match[2];
  
  try {
    const rawYaml = yaml.load(yamlStr) as Record<string, any>;
    const metadata: SkillMetadata = {};

    if (rawYaml && typeof rawYaml === 'object') {
      if (typeof rawYaml.name === 'string') metadata.name = rawYaml.name;
      if (typeof rawYaml.description === 'string') metadata.description = rawYaml.description;
      if (typeof rawYaml.alwaysApply === 'boolean') metadata.alwaysApply = rawYaml.alwaysApply;
      if (Array.isArray(rawYaml.globs)) {
        metadata.globs = rawYaml.globs.map(g => String(g));
      }
      if (Array.isArray(rawYaml.triggerKeywords)) {
        metadata.triggerKeywords = rawYaml.triggerKeywords.map(k => String(k));
      }
    }

    return { metadata, content };
  } catch (err) {
    console.error('Error parsing skill YAML frontmatter:', err);
    return {
      metadata: {},
      content: fileContent,
    };
  }
}
