import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './parser.js';

describe('parseSkillFrontmatter', () => {
  it('correctly parses valid YAML frontmatter', () => {
    const rawContent = `---
name: Code Review
description: Guidelines for reviewing code changes
alwaysApply: false
globs: ["**/*.ts", "**/*.js"]
triggerKeywords: ["review", "code quality"]
---
# Code Review Skill
This is the core content.`;

    const parsed = parseSkillFrontmatter(rawContent);

    expect(parsed.metadata.name).toBe('Code Review');
    expect(parsed.metadata.description).toBe('Guidelines for reviewing code changes');
    expect(parsed.metadata.alwaysApply).toBe(false);
    expect(parsed.metadata.globs).toEqual(['**/*.ts', '**/*.js']);
    expect(parsed.metadata.triggerKeywords).toEqual(['review', 'code quality']);
    expect(parsed.content.trim()).toBe('# Code Review Skill\nThis is the core content.');
  });

  it('handles content without frontmatter gracefully', () => {
    const rawContent = `# Only Markdown
No frontmatter exists here.`;

    const parsed = parseSkillFrontmatter(rawContent);

    expect(parsed.metadata).toEqual({});
    expect(parsed.content).toBe(rawContent);
  });

  it('handles malformed YAML frontmatter gracefully', () => {
    const rawContent = `---
name: [invalid yaml
  : broken: : :
---
# Content After Bad YAML`;

    const parsed = parseSkillFrontmatter(rawContent);

    // Should return empty metadata and raw content on parse error
    expect(parsed.metadata).toEqual({});
    expect(parsed.content).toBe(rawContent);
  });

  it('handles empty frontmatter block', () => {
    const rawContent = `---
---
# Content after empty frontmatter`;

    const parsed = parseSkillFrontmatter(rawContent);

    // Regex requires at least one char between --- delimiters,
    // so empty frontmatter falls through to the no-match path
    expect(parsed.metadata).toEqual({});
    expect(parsed.content).toBe(rawContent);
  });

  it('silently ignores unknown keys in frontmatter', () => {
    const rawContent = `---
name: Test Skill
unknownField: should be ignored
anotherRandom: 42
---
# Content`;

    const parsed = parseSkillFrontmatter(rawContent);

    expect(parsed.metadata.name).toBe('Test Skill');
    expect(parsed.metadata).not.toHaveProperty('unknownField');
    expect(parsed.metadata).not.toHaveProperty('anotherRandom');
  });

  it('handles globs with non-string items by coercing to strings', () => {
    const rawContent = `---
name: Mixed Globs
globs: [123, null, "**/*.ts"]
---
# Content`;

    const parsed = parseSkillFrontmatter(rawContent);

    expect(parsed.metadata.globs).toEqual(['123', 'null', '**/*.ts']);
  });

  it('handles triggerKeywords with non-string items by coercing to strings', () => {
    const rawContent = `---
name: Mixed Keywords
triggerKeywords: [42, true, "review"]
---
# Content`;

    const parsed = parseSkillFrontmatter(rawContent);

    expect(parsed.metadata.triggerKeywords).toEqual(['42', 'true', 'review']);
  });

  it('handles CRLF line endings', () => {
    const rawContent = '---\r\nname: CRLF Skill\r\ndescription: Windows style\r\n---\r\n# Windows Content\r\nWith CRLF endings.';

    const parsed = parseSkillFrontmatter(rawContent);

    expect(parsed.metadata.name).toBe('CRLF Skill');
    expect(parsed.metadata.description).toBe('Windows style');
    expect(parsed.content).toContain('# Windows Content');
  });

  it('returns alwaysApply only when boolean', () => {
    const rawContent = `---
name: Not Boolean
alwaysApply: "yes"
---
# Content`;

    const parsed = parseSkillFrontmatter(rawContent);

    // "yes" is a string, not boolean — should not be set
    expect(parsed.metadata.alwaysApply).toBeUndefined();
  });

  it('handles frontmatter with only dashes in content', () => {
    const rawContent = `Some content
---
Not actually frontmatter
---
More content`;

    const parsed = parseSkillFrontmatter(rawContent);

    // First --- is not at the start, so no frontmatter match
    expect(parsed.metadata).toEqual({});
    expect(parsed.content).toBe(rawContent);
  });
});
