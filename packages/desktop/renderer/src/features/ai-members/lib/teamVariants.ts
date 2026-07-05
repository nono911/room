export interface GeneratedVariant {
  name: string;
  personaAngle: string;
}

interface VariantTemplate {
  suffix: string;
  angle: string;
}

const VARIANT_ANGLES: Record<string, VariantTemplate[]> = {
  UX: [
    {
      suffix: 'Researcher',
      angle: 'Focus on user needs, evidence, tasks, and usability risks.'
    },
    {
      suffix: 'Interaction Designer',
      angle: 'Focus on flows, controls, states, and repeated-use ergonomics.'
    },
    {
      suffix: 'Visual Critic',
      angle: 'Focus on hierarchy, composition, polish, and visual consistency.'
    }
  ],
  Developer: [
    {
      suffix: 'Implementer',
      angle: 'Focus on direct implementation and integration details.'
    },
    {
      suffix: 'Reviewer',
      angle: 'Focus on correctness, maintainability, and regressions.'
    },
    {
      suffix: 'QA Analyst',
      angle: 'Focus on validation, edge cases, and failure modes.'
    }
  ]
};

const FALLBACK_ANGLES: VariantTemplate[] = [
  {
    suffix: 'Strategy',
    angle: 'Focus on goals, tradeoffs, and decision criteria.'
  },
  {
    suffix: 'Execution',
    angle: 'Focus on concrete steps, dependencies, and delivery.'
  },
  {
    suffix: 'Critique',
    angle: 'Focus on risks, contradictions, and missing evidence.'
  },
  {
    suffix: 'Research',
    angle: 'Focus on assumptions, evidence, and open questions.'
  },
  {
    suffix: 'QA',
    angle: 'Focus on validation, acceptance criteria, and edge cases.'
  }
];

function uniqueName(candidate: string, used: Set<string>): string {
  let suffix = 2;
  let next = candidate;

  while (used.has(next.toLowerCase())) {
    next = `${candidate} ${suffix}`;
    suffix += 1;
  }

  used.add(next.toLowerCase());
  return next;
}

export function generateTemplateVariants(
  templateName: string,
  count: number,
  existingNames: string[]
): GeneratedVariant[] {
  const variants = VARIANT_ANGLES[templateName] ?? FALLBACK_ANGLES;
  const total = Math.max(1, Math.min(12, Math.floor(count || 1)));
  const used = new Set(existingNames.map(name => name.toLowerCase()));

  return Array.from({ length: total }, (_, index) => {
    const variant = variants[index % variants.length];
    return {
      name: uniqueName(`${templateName} ${variant.suffix}`, used),
      personaAngle: variant.angle
    };
  });
}
