import { describe, expect, it } from 'vitest';
import { generateTemplateVariants } from './teamVariants.js';

describe('team variant generation', () => {
  it('generates differentiated UX variants', () => {
    const variants = generateTemplateVariants('UX', 3, []);
    expect(variants.map(variant => variant.name)).toEqual([
      'UX Researcher',
      'UX Interaction Designer',
      'UX Visual Critic'
    ]);
    expect(new Set(variants.map(variant => variant.personaAngle)).size).toBe(3);
  });

  it('suffixes colliding names', () => {
    const variants = generateTemplateVariants('UX', 1, ['UX Researcher']);
    expect(variants[0].name).toBe('UX Researcher 2');
  });
});
