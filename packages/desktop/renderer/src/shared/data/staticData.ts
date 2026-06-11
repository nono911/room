import { PERSONA_TEMPLATES, type PersonaTemplateName } from '@room/engine/agents/personaTemplates';
import type { TemplateSkill } from '../../types/domain.js';

export const PROVIDER_PRESETS: { id: string; label: string; baseUrl: string; keyless?: boolean }[] = [
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', keyless: true }
];

export const LEGACY_PROVIDER_IDS: Record<string, string> = { Gemini: 'gemini', Claude: 'anthropic', Codex: 'openai' };
export const normalizeProviderId = (value: string) => LEGACY_PROVIDER_IDS[value] || value;

export const taskTypeOptions = [
  { value: 'general', label: 'General' },
  { value: 'coding', label: 'Coding' },
  { value: 'writing', label: 'Writing' },
  { value: 'film', label: 'Film / Story' },
  { value: 'research', label: 'Research' },
  { value: 'business', label: 'Business' },
  { value: 'design', label: 'Design' }
];

export const roleTemplateSkills = {
  Product: [
    {
      filename: 'requirements-framing.md',
      title: 'Requirements Framing',
      content: `Use this skill when turning a rough request into product requirements.

- Identify the user goal before discussing implementation.
- Separate in-scope behavior from out-of-scope ideas.
- Write acceptance criteria that can be tested by a human or automated check.
- Capture open product decisions explicitly instead of assuming them.`
    },
    {
      filename: 'workflow-boundaries.md',
      title: 'Workflow Boundaries',
      content: `Use this skill when defining how a feature fits into a user workflow.

- Name the start and end state of the workflow.
- List required inputs, outputs, and ownership boundaries.
- Call out edge cases, empty states, and permission boundaries.
- Flag any flow that depends on missing context or unclear policy.`
    }
  ],
  UX: [
    {
      filename: 'interaction-states.md',
      title: 'Interaction States',
      content: `Use this skill when reviewing or designing UI behavior.

- Cover loading, empty, error, success, disabled, and partial states.
- Prefer controls that match the user's task and existing app patterns.
- Check that labels, affordances, and feedback are clear without explanation text.
- Make mobile and desktop behavior explicit when layout can change.`
    },
    {
      filename: 'accessibility-review.md',
      title: 'Accessibility Review',
      content: `Use this skill when evaluating interface accessibility.

- Check keyboard reachability, focus order, and visible focus states.
- Verify contrast, readable text sizing, and non-color-only status cues.
- Make form labels, errors, and actions understandable to assistive tech.
- Flag interaction patterns that may confuse repeated-use workflows.`
    }
  ],
  Screenwriter: [
    {
      filename: 'scene-craft.md',
      title: 'Scene Craft',
      content: `Use this skill when shaping a scene or sequence.

- Define the dramatic purpose of the scene.
- Track character want, obstacle, conflict, turn, and consequence.
- Remove beats that repeat information without changing tension.
- Suggest concrete alternatives when the scene lacks momentum.`
    },
    {
      filename: 'dialogue-and-subtext.md',
      title: 'Dialogue and Subtext',
      content: `Use this skill when writing or reviewing dialogue.

- Make each line reveal intent, pressure, relationship, or avoidance.
- Prefer subtext over direct explanation when the audience can infer meaning.
- Keep character voices distinct through rhythm, vocabulary, and priorities.
- Flag exposition that belongs in action, image, or conflict instead.`
    }
  ],
  'Story Editor': [
    {
      filename: 'story-continuity.md',
      title: 'Story Continuity',
      content: `Use this skill when checking narrative consistency.

- Track cause and effect across scenes.
- Verify character motivation, timeline, stakes, and world rules.
- Identify contradictions, missing setup, and unresolved payoffs.
- Recommend revisions that preserve the strongest parts of the story.`
    },
    {
      filename: 'pacing-review.md',
      title: 'Pacing Review',
      content: `Use this skill when judging story rhythm.

- Find slow sections, rushed turns, repeated beats, and missing escalation.
- Check whether each scene changes emotion, information, power, or stakes.
- Balance setup, conflict, reveal, and consequence.
- Suggest cuts or expansions with a clear dramatic reason.`
    }
  ],
  Producer: [
    {
      filename: 'production-risk.md',
      title: 'Production Risk',
      content: `Use this skill when evaluating feasibility and scope.

- Identify schedule, budget, staffing, legal, location, asset, and dependency risks.
- Separate must-have decisions from nice-to-have polish.
- Recommend the smallest next step that reduces uncertainty.
- Call out assumptions that could derail delivery later.`
    },
    {
      filename: 'audience-positioning.md',
      title: 'Audience Positioning',
      content: `Use this skill when clarifying who the work is for.

- Define audience, promise, comparable works, and differentiation.
- Check whether creative choices support the intended audience experience.
- Identify messaging risks and expectation mismatches.
- Translate creative direction into practical decision criteria.`
    }
  ],
  Researcher: [
    {
      filename: 'source-quality.md',
      title: 'Source Quality',
      content: `Use this skill when working with claims, references, or uncertain facts.

- Separate verified facts, assumptions, opinions, and hypotheses.
- Prefer primary sources, dated references, and clearly attributable evidence.
- Note source limitations, conflicts, and recency risks.
- Recommend what should be verified before decisions depend on it.`
    },
    {
      filename: 'assumption-tracking.md',
      title: 'Assumption Tracking',
      content: `Use this skill when a discussion depends on incomplete information.

- List assumptions in plain language.
- Mark which assumptions are low-risk and which could change the decision.
- Propose targeted research questions or experiments.
- Keep conclusions proportional to the evidence available.`
    }
  ],
  Architect: [
    {
      filename: 'system-design.md',
      title: 'System Design',
      content: `Use this skill when turning requirements into technical shape.

- Identify affected modules, data flow, boundaries, and contracts.
- Prefer existing architecture and local patterns before adding abstractions.
- Call out migrations, compatibility risks, and operational impact.
- Produce a plan that implementers can follow without guessing.`
    },
    {
      filename: 'integration-risk.md',
      title: 'Integration Risk',
      content: `Use this skill when a feature crosses APIs, services, files, or tools.

- Map dependencies, permissions, failure modes, and ownership boundaries.
- Check how errors, retries, partial success, and stale data are handled.
- Identify test seams and observability needs.
- Flag decisions that need an ADR or explicit approval.`
    }
  ],
  Implementer: [
    {
      filename: 'implementation-planning.md',
      title: 'Implementation Planning',
      content: `Use this skill when converting a plan into code work.

- Name exact files, functions, data structures, and UI states to change.
- Sequence edits to keep the project buildable.
- Include migrations, config changes, and cleanup work when needed.
- Keep scope tight and avoid unrelated refactors.`
    },
    {
      filename: 'validation-plan.md',
      title: 'Validation Plan',
      content: `Use this skill when deciding how to prove a change works.

- List build, unit, integration, UI, and manual checks relevant to the risk.
- Include negative cases and regression areas.
- State what cannot be tested locally and why.
- Tie validation back to acceptance criteria.`
    }
  ],
  Developer: [
    {
      filename: 'workspace-implementation.md',
      title: 'Workspace Implementation',
      content: `Use this skill when executing a coding task in the user's workspace.

- Work only inside the active workspace root.
- Read the relevant files before editing.
- Keep edits scoped to the task and existing code patterns.
- Report changed files, validation commands, and blockers clearly.`
    },
    {
      filename: 'review-feedback-resolution.md',
      title: 'Review Feedback Resolution',
      content: `Use this skill when a reviewer sends required changes back to the developer.

- Address each OPEN_FINDING and REQUIRED_CHANGE explicitly.
- Do not introduce unrelated refactors while fixing review feedback.
- Re-run or recommend the smallest useful validation after each fix.
- State which findings are resolved and which remain blocked.`
    }
  ],
  Reviewer: [
    {
      filename: 'review-findings.md',
      title: 'Review Findings',
      content: `Use this skill when reviewing a plan or code change.

- Lead with concrete bugs, risks, missing tests, and behavior gaps.
- Reference files, modules, or user flows precisely.
- Distinguish blocking issues from suggestions.
- Do not approve while open findings or required changes remain.`
    },
    {
      filename: 'regression-risk.md',
      title: 'Regression Risk',
      content: `Use this skill when checking what a change might break.

- Trace adjacent flows, shared utilities, persisted data, and compatibility paths.
- Look for hidden assumptions in old behavior.
- Require tests or manual checks for high-risk paths.
- Ask for simpler scope when risk is not justified by the feature.`
    }
  ],
  Security: [
    {
      filename: 'threat-modeling.md',
      title: 'Threat Modeling',
      content: `Use this skill when reviewing security impact.

- Identify trust boundaries, attackers, assets, and abuse cases.
- Focus on practical exploit paths rather than abstract concerns.
- Check auth, permissions, filesystem, network, and local command risks.
- Require concrete safeguards and tests for meaningful threats.`
    },
    {
      filename: 'privacy-and-secrets.md',
      title: 'Privacy and Secrets',
      content: `Use this skill when handling credentials or sensitive data.

- Keep API keys, tokens, and local credentials out of project files and logs.
- Minimize stored personal or sensitive data.
- Verify where data is persisted, transmitted, and displayed.
- Flag accidental disclosure through exports, prompts, discussions, or workspace files.`
    }
  ],
  QA: [
    {
      filename: 'test-strategy.md',
      title: 'Test Strategy',
      content: `Use this skill when planning verification.

- Derive tests from acceptance criteria and user workflows.
- Cover happy path, failure path, edge cases, and regression paths.
- Choose the lightest test type that gives useful confidence.
- Include manual checks when automation is not yet available.`
    },
    {
      filename: 'edge-cases.md',
      title: 'Edge Cases',
      content: `Use this skill when searching for behavior gaps.

- Check empty, invalid, duplicated, stale, missing, large, and interrupted states.
- Include permission, offline, cancellation, and partial failure cases.
- Verify UI state recovery and persisted data consistency.
- Turn each important edge case into a concrete expected behavior.`
    }
  ],
  'Room Moderator': [
    {
      filename: 'quality-gate.md',
      title: 'Quality Gate',
      content: `Use this skill when deciding whether a collaborative discussion is complete.

- Check whether the user's goal has been answered with concrete, usable output.
- Identify contradictions, missing decisions, vague claims, and agents ignoring each other.
- Decide PASS only when another discussion round would not materially improve the result.
- If more work is needed, write focused instructions for the next round.`
    },
    {
      filename: 'discussion-moderation.md',
      title: 'Discussion Moderation',
      content: `Use this skill when guiding a multi-agent room.

- Keep contributors aligned to the same goal and prior messages.
- Ask specific agents to deepen, challenge, or resolve specific points.
- Prevent repeated generic answers.
- Preserve decisions and open questions clearly for future work.`
    }
  ],
  'Room Reporter': [
    {
      filename: 'chat-summary.md',
      title: 'Chat Summary',
      content: `Use this skill when turning a discussion transcript into durable workspace memory.

- Do not add new ideas unless clearly marked as a recommendation.
- Preserve decisions, options, open questions, risks, and next steps.
- Prefer compact, reusable context over a message-by-message recap.
- Write so a future chat can use the summary without reading the raw transcript.`
    },
    {
      filename: 'memory-artifact.md',
      title: 'Memory Artifact',
      content: `Use this skill when creating documents that future AI members will rely on.

- Separate what is decided from what is still uncertain.
- Capture names, constraints, assumptions, and unresolved trade-offs.
- Keep the summary faithful to the discussion.
- Make follow-up actions concrete and easy to scan.`
    }
  ],
  'Macro Strategist': [
    {
      filename: 'macro-regime-analysis.md',
      title: 'Macro Regime Analysis',
      content: `Use this skill when assessing the economic backdrop for any market view.

- Identify the current regime: growth, inflation, interest rates, and liquidity direction.
- Track central bank policy (Fed, BOT, and other relevant banks) and what is already priced in.
- Separate structural trends from short-term noise and one-off events.
- State which data releases or policy decisions could invalidate the current regime view.`
    },
    {
      filename: 'cross-asset-impact.md',
      title: 'Cross-Asset Impact',
      content: `Use this skill when translating macro shifts into asset-class implications.

- Map how rates, the US dollar, and liquidity flow into equities, crypto, gold, and FX.
- Note when correlations between assets are stable and when they break down.
- Distinguish risk-on and risk-off positioning and what drives the switch.
- Flag crowded consensus trades that are vulnerable to reversal.`
    }
  ],
  'Equity Analyst': [
    {
      filename: 'fundamental-valuation.md',
      title: 'Fundamental Valuation',
      content: `Use this skill when evaluating a stock or equity sector.

- Anchor on earnings quality, growth drivers, margins, balance sheet, and cash flow.
- Use valuation ranges (P/E, EV/EBITDA, dividend yield) against history and peers, not single point targets.
- Separate company-specific drivers from sector and market-wide moves.
- State the thesis, the key risks to it, and what evidence would change the view.`
    },
    {
      filename: 'thai-global-equity-context.md',
      title: 'Thai and Global Equity Context',
      content: `Use this skill when comparing Thai (SET) and international equities.

- Account for SET-specific factors: foreign fund flows, THB direction, dividend culture, and sector concentration.
- For global stocks, note index context, currency exposure, and trading-hour or access constraints for Thai investors.
- Compare opportunities on the same basis: valuation, growth, liquidity, and currency risk.
- Flag tax, fee, and FX-conversion considerations that change real returns.`
    }
  ],
  'Crypto Analyst': [
    {
      filename: 'token-fundamentals.md',
      title: 'Token Fundamentals',
      content: `Use this skill when evaluating a crypto asset or protocol.

- Examine tokenomics: supply schedule, unlocks, emissions, and who holds what.
- Assess real usage and fee revenue instead of marketing narratives.
- Identify dependency risks: bridges, custodians, regulatory exposure, and key persons.
- Treat unverifiable claims as assumptions and say what on-chain or audit evidence would confirm them.`
    },
    {
      filename: 'onchain-market-signals.md',
      title: 'On-Chain and Market Signals',
      content: `Use this skill when reading crypto market conditions.

- Use funding rates, open interest, liquidations, and exchange flows to gauge positioning.
- Track BTC dominance and majors-versus-alts rotation before judging individual coins.
- Note liquidity depth and slippage risk, especially for smaller tokens.
- Mark narrative-driven moves explicitly and state what sustains or kills the narrative.`
    }
  ],
  'FX & Commodities Analyst': [
    {
      filename: 'currency-drivers.md',
      title: 'Currency Drivers',
      content: `Use this skill when analyzing forex pairs or THB exposure.

- Anchor on interest-rate differentials, central bank paths, and capital flows.
- Track USD strength (DXY) as the reference frame for major and THB crosses.
- Separate trend drivers from intervention risk and event-driven spikes.
- State invalidation levels and upcoming events (CPI, FOMC, MPC) that could flip the view.`
    },
    {
      filename: 'gold-and-commodity-context.md',
      title: 'Gold and Commodity Context',
      content: `Use this skill when evaluating gold or commodity positions.

- Link gold to real yields, USD direction, central bank buying, and safe-haven demand.
- For Thai investors, separate global XAU/USD moves from THB-quoted gold (baht gold) effects.
- Note seasonality, physical-versus-paper market gaps, and storage or spread costs.
- Treat geopolitical premium as temporary unless structurally supported.`
    }
  ],
  'Technical Analyst': [
    {
      filename: 'chart-structure.md',
      title: 'Chart Structure',
      content: `Use this skill when reading price action on any instrument.

- Establish trend and key levels on the higher timeframe before zooming in.
- Use support/resistance, market structure, and volume; avoid stacking redundant indicators.
- Mark ranges, breakouts, and failed breakouts explicitly.
- State the level that invalidates the read, not just the level that confirms it.`
    },
    {
      filename: 'trade-plan-discipline.md',
      title: 'Trade Plan Discipline',
      content: `Use this skill when turning a market view into a trade plan.

- Define entry zone, stop loss, and targets before discussing position size.
- Require a reward-to-risk ratio that justifies the setup; reject trades without a defined stop.
- Specify the timeframe and the conditions under which the plan expires.
- Never average down into a losing position as a way to repair a broken plan.`
    }
  ],
  'Risk Manager': [
    {
      filename: 'position-sizing.md',
      title: 'Position Sizing',
      content: `Use this skill when deciding how much capital a position deserves.

- Size from the stop distance and the maximum acceptable loss per trade, not from conviction.
- Cap total exposure per asset class and per correlated theme.
- Account for leverage, funding costs, and gap risk in volatile assets like crypto.
- Reduce size when volatility expands or when recent losses cluster.`
    },
    {
      filename: 'portfolio-risk-review.md',
      title: 'Portfolio Risk Review',
      content: `Use this skill when reviewing overall portfolio health.

- Check concentration across assets, sectors, currencies, and single themes.
- Stress-test the portfolio against rate shocks, THB moves, and crypto drawdowns.
- Verify that liquidity needs and time horizon match the holdings.
- Flag positions held for emotional reasons rather than a living thesis.`
    }
  ]
} satisfies Record<string, readonly TemplateSkill[]>;

export const agentPersonaTemplates = PERSONA_TEMPLATES.map(template => ({
  name: template.name,
  role: template.role,
  provider: template.provider,
  prompt: template.prompt,
  skills: roleTemplateSkills[template.name as keyof typeof roleTemplateSkills] ?? []
}));

export type TemplateRoleName = PersonaTemplateName;

export const teamPresets: {
  name: string;
  description: string;
  roles: TemplateRoleName[];
}[] = [
  {
    name: 'Film / Story Development',
    description: 'Shape story, scenes, audience fit, production constraints, and next creative decisions.',
    roles: ['Screenwriter', 'Story Editor', 'Producer', 'Researcher']
  },
  {
    name: 'Software Feature Planning',
    description: 'Turn product ideas into UX, architecture, implementation, review, and QA plans.',
    roles: ['Product', 'UX', 'Architect', 'Implementer', 'Reviewer', 'QA']
  },
  {
    name: 'Coding Execution',
    description: 'Assign a software developer to edit the workspace, then send the result through senior review and QA.',
    roles: ['Developer', 'Reviewer', 'QA']
  },
  {
    name: 'Creative Task Execution',
    description: 'Assign a creative doer to draft the work, then send it through editorial and production review.',
    roles: ['Screenwriter', 'Story Editor', 'Producer']
  },
  {
    name: 'Research Task Execution',
    description: 'Assign a researcher to produce a memo, then send it through evidence and usefulness review.',
    roles: ['Researcher', 'Reviewer', 'Producer']
  },
  {
    name: 'Research / Analysis',
    description: 'Separate facts from assumptions, critique conclusions, and synthesize next steps.',
    roles: ['Researcher', 'Reviewer', 'QA']
  },
  {
    name: 'Writing / Editorial',
    description: 'Draft, critique, revise, and prepare written work for a target audience.',
    roles: ['Screenwriter', 'Story Editor', 'Producer']
  },
  {
    name: 'Business Planning',
    description: 'Clarify product direction, research assumptions, risks, constraints, and execution tasks.',
    roles: ['Product', 'Researcher', 'Reviewer', 'Producer']
  },
  {
    name: 'Investing / Trading Desk',
    description: 'Analyze Thai and global stocks, crypto, gold, and forex with macro context, trade setups, and strict risk control.',
    roles: ['Macro Strategist', 'Equity Analyst', 'Crypto Analyst', 'FX & Commodities Analyst', 'Technical Analyst', 'Risk Manager']
  }
];
