import React, { useState, useEffect } from 'react';
import { getFallbackModels, type ModelOption } from '@room/engine/modelCatalog';
import { parseShellArgs } from '@room/engine/shellArgs';
import { PERSONA_TEMPLATES, type PersonaTemplateName } from '@room/engine/agents/personaTemplates';

// Type definitions for Electron IPC API
interface ProjectData {
  projectMd: string;
  archMd: string;
  hasScanData?: boolean;
  tasks: string[];
  decisions: string[];
  reviews: string[];
  documents: string[];
  discussions: string[];
  skills: string[];
  agents: any[];
}

interface DetectedAgent {
  id: string;
  name: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

interface WorkspaceFileEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind?: 'file' | 'directory';
}

interface ContextPickerItem {
  ref: string;
  label: string;
  type: 'workspace' | 'task' | 'doc' | 'discussion' | 'file';
  path?: string;
  detail: string;
  modifiedAt?: string;
  size?: number;
}

interface SkillPreviewResult {
  delivery: string;
  readableCount: number;
  totalCount: number;
  items: {
    filename: string;
    readable: boolean;
    source?: 'skills' | 'roles';
    bytes?: number;
    heading?: string;
    error?: string;
  }[];
}

interface MaskedProvider {
  id: string;
  label: string;
  kind: 'gemini' | 'anthropic' | 'openai-compatible';
  baseUrl?: string;
  builtIn: boolean;
  hasKey: boolean;
}

const PROVIDER_PRESETS: { id: string; label: string; baseUrl: string; keyless?: boolean }[] = [
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', keyless: true }
];

const LEGACY_PROVIDER_IDS: Record<string, string> = { Gemini: 'gemini', Claude: 'anthropic', Codex: 'openai' };
const normalizeProviderId = (value: string) => LEGACY_PROVIDER_IDS[value] || value;
const providerLabel = (providers: MaskedProvider[], id: string) => providers.find(provider => provider.id === normalizeProviderId(id))?.label || id;

declare global {
  interface Window {
    electronAPI: {
      selectProjectDir: () => Promise<{ path: string; isRoomProject: boolean } | null>;
      openProjectDir: (dirPath: string) => Promise<{ path: string; isRoomProject: boolean } | null>;
      createWorkspace: (workspaceName: string) => Promise<{ success: boolean; path?: string; isRoomProject?: boolean; error?: string } | null>;
      roomInit: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
      getProjectData: (dirPath: string) => Promise<{
        success: boolean;
        projectMd: string;
        archMd: string;
        hasScanData?: boolean;
        tasks: string[];
        decisions: string[];
        reviews: string[];
        documents?: string[];
        discussions: string[];
        skills: string[];
        agents: any[];
        error?: string;
      }>;
      readRoomFile: (dirPath: string, section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions' | 'skills', filename: string) => Promise<{ success: boolean; content?: string; sourceSection?: string; error?: string }>;
      listWorkspaceFiles: (dirPath: string) => Promise<{ success: boolean; files?: WorkspaceFileEntry[]; truncated?: boolean; error?: string }>;
      searchContextItems: (dirPath: string, query?: string) => Promise<{ success: boolean; items?: ContextPickerItem[]; error?: string }>;
      readWorkspaceFile: (dirPath: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      runScan: (dirPath: string, mainAgent?: string, modelName?: string, allowDangerousCli?: boolean) => Promise<{ success: boolean; message: string }>;
      runDiscussion: (
        dirPath: string,
        topic: string,
        agentNames?: string[],
        options?: { maxRounds?: number; reviewMode?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; moderatorName?: string; autoSummary?: boolean; summaryAgentName?: string; useProjectSummaryAgent?: boolean }
      ) => Promise<{
        success: boolean;
        summary?: { filename: string; content: string };
        moderatorActions?: { type: 'task' | 'adr'; id?: string; title?: string; filename?: string }[];
        log?: {
          id: string;
          title: string;
          topic?: string;
          status: string;
          messages: {
            type?: 'user' | 'agent';
            agentName: string;
            providerName: string;
            modelName?: string;
            content: string;
            timestamp: string;
            contextMessages?: {
              type?: 'user' | 'agent';
              agentName: string;
              providerName: string;
              timestamp: string;
            }[];
            references?: { author: string; reason?: string }[];
          }[];
        };
        error?: string;
      }>;
      runTask: (
        dirPath: string,
        task: string,
        options?: { taskType?: string; doerName?: string; reviewerNames?: string[]; maxCycles?: number; contextRefs?: string[] }
      ) => Promise<{
        success: boolean;
        result?: {
          id: string;
          title: string;
          task: string;
          taskType?: string;
          status: string;
          cycles: number;
          messages: {
            type?: 'user' | 'agent';
            agentName: string;
            providerName: string;
            modelName?: string;
            content: string;
            timestamp: string;
            contextMessages?: {
              type?: 'user' | 'agent';
              agentName: string;
              providerName: string;
              timestamp: string;
            }[];
          }[];
          markdownFilename: string;
          jsonFilename: string;
          artifactFilename?: string;
          approvedBy?: string[];
          statusSummary?: string;
        };
        error?: string;
      }>;
      summarizeDiscussion: (dirPath: string, discussionId: string, options?: { agentNames?: string[]; summaryAgentName?: string; useProjectSummaryAgent?: boolean }) => Promise<{ success: boolean; filename?: string; content?: string; error?: string }>;
      generateTasksFromDiscussion: (dirPath: string, discussionId: string, options?: { moderatorName?: string }) => Promise<{ success: boolean; createdTaskCards?: TaskBoardCard[]; errors?: string[]; error?: string }>;
      loadTaskBoard: (dirPath: string) => Promise<{ success: boolean; cards?: TaskBoardCard[]; error?: string }>;
      onDiscussionEvent: (callback: (event: DiscussionIpcEvent) => void) => () => void;
      saveRoomFile: (dirPath: string, section: 'documents' | 'tasks', filename: string, content: string) => Promise<{ success: boolean; filename?: string; error?: string }>;
      saveContextFile: (dirPath: string, filename: 'overview.md' | 'structure.md', content: string) => Promise<{ success: boolean; error?: string }>;
      saveAgent: (dirPath: string, agent: any) => Promise<{ success: boolean; error?: string }>;
      deleteAgent: (dirPath: string, agentName: string) => Promise<{ success: boolean; error?: string }>;
      saveSkill: (dirPath: string, name: string, content: string) => Promise<{ success: boolean; error?: string }>;
      previewAgentSkills: (dirPath: string, agent: any) => Promise<{ success: boolean; error?: string } & Partial<SkillPreviewResult>>;
      detectLocalAgents: () => Promise<{ success: boolean; agents?: DetectedAgent[]; error?: string }>;
      loadProviders: () => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
      saveProvider: (provider: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
      deleteProvider: (providerId: string) => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
      testProvider: (providerId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
      detectCliModels: (cliId: string) => Promise<{ success: boolean; models?: { value: string; label: string }[]; error?: string }>;
      detectApiModels: (providerId: string) => Promise<{ success: boolean; models?: { value: string; label: string }[]; error?: string }>;
      loadMcpConfig: (dirPath: string) => Promise<{ success: boolean; config?: any; error?: string }>;
      saveMcpConfig: (dirPath: string, config: any) => Promise<{ success: boolean; error?: string }>;
      loadProjectConfig: (dirPath: string) => Promise<{ success: boolean; config?: any; error?: string }>;
      saveProjectConfig: (dirPath: string, config: any) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

interface TaskBoardCard {
  id: string;
  title: string;
  kind: 'epic' | 'task' | 'subtask';
  parentId?: string;
  details?: string;
  status: 'todo' | 'in_progress' | 'done';
  sourceDiscussionId?: string;
  createdAt: string;
}

interface UIMessage {
  id?: string;
  author: string;
  role: string;
  time: string;
  text: string;
  streaming?: boolean;
  progressStep?: number;
  contextSummary?: string;
  round?: number;
}

type DiscussionIpcEvent =
  | {
      type: 'discussion_started';
      discussionId: string;
      title: string;
    }
  | {
      type: 'agent_started';
      discussionId: string;
      agentName: string;
      providerName: string;
      modelName?: string;
      role: string;
      round: number;
      timestamp: string;
    }
  | {
      type: 'agent_chunk';
      discussionId: string;
      agentName: string;
      providerName: string;
      modelName?: string;
      round: number;
      chunk: string;
    }
  | {
      type: 'message_completed';
      discussionId: string;
      round: number;
      message: {
        agentName: string;
        providerName: string;
        modelName?: string;
        content: string;
        timestamp: string;
        contextMessages?: {
          agentName: string;
          providerName: string;
          timestamp: string;
        }[];
      };
    }
  | {
      type: 'agent_error';
      discussionId: string;
      agentName: string;
      providerName: string;
      modelName?: string;
      round: number;
      error: string;
    }
  | {
      type: 'discussion_completed';
      discussionId: string;
      log: any;
    }
  | {
      type: 'discussion_failed';
      discussionId: string;
      error: string;
    };

type LocalCliPermissionMode = 'safe' | 'dangerous';

interface ProjectConfigState {
  mainAgent: string;
  modelName?: string;
  allowDangerousCli?: boolean;
}

type TemplateSkill = {
  filename: string;
  title: string;
  content: string;
};

const taskTypeOptions = [
  { value: 'general', label: 'General' },
  { value: 'coding', label: 'Coding' },
  { value: 'writing', label: 'Writing' },
  { value: 'film', label: 'Film / Story' },
  { value: 'research', label: 'Research' },
  { value: 'business', label: 'Business' },
  { value: 'design', label: 'Design' }
];

const roleTemplateSkills = {
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
- Check auth, permissions, injection, filesystem, network, and local command risks.
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

const agentPersonaTemplates = PERSONA_TEMPLATES.map(template => ({
  name: template.name,
  role: template.role,
  provider: template.provider,
  prompt: template.prompt,
  skills: roleTemplateSkills[template.name as keyof typeof roleTemplateSkills] ?? []
}));

type TemplateRoleName = PersonaTemplateName;

const teamPresets: {
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

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isRoomProject, setIsRoomProject] = useState<boolean>(false);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Discussions');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Recent projects state loaded from localStorage
  const [recentProjects, setRecentProjects] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('recentProjects');
      if (saved) {
        return JSON.parse(saved);
      }
      return [];
    } catch {
      return [];
    }
  });

  // Form states for creating custom agents
  const [newAgentName, setNewAgentName] = useState<string>('');
  const [newAgentRole, setNewAgentRole] = useState<string>('');
  const [newAgentProvider, setNewAgentProvider] = useState<string>('gemini');
  const [newAgentCommand, setNewAgentCommand] = useState<string>('');
  const [newAgentPrompt, setNewAgentPrompt] = useState<string>('');
  const [newAgentSkills, setNewAgentSkills] = useState<string[]>([]);
  const [newAgentPreset, setNewAgentPreset] = useState<'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none'>('none');
  const [newAgentStdinFormat, setNewAgentStdinFormat] = useState<'text' | 'json'>('text');
  const [newAgentPermissionMode, setNewAgentPermissionMode] = useState<LocalCliPermissionMode>('safe');
  const [detectedClis, setDetectedClis] = useState<DetectedAgent[]>([]);
  const [showContextPanel, setShowContextPanel] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<any | null>(null);
  const [showOnboardingTour, setShowOnboardingTour] = useState<boolean>(false);
  const [onboardingStep, setOnboardingStep] = useState<number>(0);
  const [dismissedOnboarding, setDismissedOnboarding] = useState<boolean>(false);
  const [onboardingSessionDismissed, setOnboardingSessionDismissed] = useState<boolean>(false);
  const [hasCompletedScan, setHasCompletedScan] = useState<boolean>(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);

  // Custom workspace control states
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  const [customSkillName, setCustomSkillName] = useState<string>('');
  const [customSkillDesc, setCustomSkillDesc] = useState<string>('');
  const [editingSkillFile, setEditingSkillFile] = useState<string>('');
  const [editingSkillContent, setEditingSkillContent] = useState<string>('');
  const [editingSkillSource, setEditingSkillSource] = useState<'skills' | 'roles'>('skills');
  const [skillPreview, setSkillPreview] = useState<SkillPreviewResult | null>(null);
  const [newAgentModel, setNewAgentModel] = useState<string>('');
  const [newAgentModelCustom, setNewAgentModelCustom] = useState<boolean>(false);
  const [selectedDiscussionAgents, setSelectedDiscussionAgents] = useState<string[]>([]);
  const [dynamicCliModels, setDynamicCliModels] = useState<Record<string, { value: string; label: string }[]>>({});
  const [contextPickerTarget, setContextPickerTarget] = useState<'discussion' | 'task' | null>(null);
  const [contextPickerQuery, setContextPickerQuery] = useState<string>('');
  const [contextPickerTab, setContextPickerTab] = useState<'Suggested' | 'Tasks' | 'Docs' | 'Files'>('Suggested');
  const [contextPickerItems, setContextPickerItems] = useState<ContextPickerItem[]>([]);
  const [contextPickerLoading, setContextPickerLoading] = useState<boolean>(false);

  // MCP Client State
  const [mcpConfig, setMcpConfig] = useState<{ mcpServers: Record<string, any> }>({ mcpServers: {} });
  const [selectedMcpServer, setSelectedMcpServer] = useState<string | null>(null);
  const [mcpServerName, setMcpServerName] = useState<string>('');
  const [mcpServerCommand, setMcpServerCommand] = useState<string>('');
  const [mcpServerArgs, setMcpServerArgs] = useState<string>('');
  const [mcpServerEnv, setMcpServerEnv] = useState<string>('');

  // Main Workspace Agent & Visual Customizer State
  const [projectConfig, setProjectConfig] = useState<ProjectConfigState>({ mainAgent: 'none', allowDangerousCli: false });
  const [providers, setProviders] = useState<MaskedProvider[]>([]);
  const [providerKeyDrafts, setProviderKeyDrafts] = useState<Record<string, string>>({});
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [addProviderDraft, setAddProviderDraft] = useState<{ id: string; label: string; baseUrl: string; apiKey: string }>({ id: '', label: '', baseUrl: '', apiKey: '' });
  const [contentTheme, setContentTheme] = useState<string>(() => localStorage.getItem('room_theme') || 'default');
  const [contentFontFamily, setContentFontFamily] = useState<string>(() => localStorage.getItem('room_font_family') || 'system-ui');
  const [contentFontSize, setContentFontSize] = useState<string>(() => localStorage.getItem('room_font_size') || '16px');
  const [contentLineHeight, setContentLineHeight] = useState<string>(() => localStorage.getItem('room_line_height') || '1.6');
  const [discussionReviewMode, setDiscussionReviewMode] = useState<boolean>(true);
  const [discussionMaxRounds, setDiscussionMaxRounds] = useState<number>(6);
  const [discussionQualityGate, setDiscussionQualityGate] = useState<boolean>(false);
  const [discussionModeratorName, setDiscussionModeratorName] = useState<string>('');
  const [discussionAutoSummary, setDiscussionAutoSummary] = useState<boolean>(false);
  const [discussionSummaryAgentName, setDiscussionSummaryAgentName] = useState<string>('__project__');
  const [selectedDiscussionContextRefs, setSelectedDiscussionContextRefs] = useState<string[]>(['workspace:overview', 'workspace:structure']);
  const [codingTaskInput, setCodingTaskInput] = useState<string>('');
  const [taskRunType, setTaskRunType] = useState<string>('general');
  const [codingTaskMessages, setCodingTaskMessages] = useState<UIMessage[]>([]);
  const [codingTaskDeveloperName, setCodingTaskDeveloperName] = useState<string>('');
  const [codingTaskReviewerNames, setCodingTaskReviewerNames] = useState<string[]>([]);
  const [codingTaskMaxCycles, setCodingTaskMaxCycles] = useState<number>(2);
  const [selectedCodingTaskContextRefs, setSelectedCodingTaskContextRefs] = useState<string[]>(['workspace:overview', 'workspace:structure']);
  const [lastCodingTaskResult, setLastCodingTaskResult] = useState<any | null>(null);
  const [taskRunView, setTaskRunView] = useState<'setup' | 'timeline' | 'artifact' | 'trace'>('setup');
  const [openRounds, setOpenRounds] = useState<Record<number, boolean>>({});
  const [expandedMsgKeys, setExpandedMsgKeys] = useState<Record<string, boolean>>({});
  const [lastMaxRound, setLastMaxRound] = useState<number>(-1);
  const [activeDiscussionId, setActiveDiscussionId] = useState<string | null>(null);
  const [lastDiscussionLog, setLastDiscussionLog] = useState<any | null>(null);
  const [taskBoardCards, setTaskBoardCards] = useState<TaskBoardCard[]>([]);
  const [showInspector, setShowInspector] = useState(false);
  const [lastDiscussionTopic, setLastDiscussionTopic] = useState<string>('');
  const [contextOverviewDraft, setContextOverviewDraft] = useState<string>('');
  const [contextStructureDraft, setContextStructureDraft] = useState<string>('');
  const [selectedDecisionFile, setSelectedDecisionFile] = useState<string>('');
  const [selectedDecisionContent, setSelectedDecisionContent] = useState<string>('');
  const [selectedTaskFile, setSelectedTaskFile] = useState<string>('');
  const [selectedTaskContent, setSelectedTaskContent] = useState<string>('');
  const [selectedReviewFile, setSelectedReviewFile] = useState<string>('');
  const [selectedReviewSection, setSelectedReviewSection] = useState<'documents' | 'reviews' | 'discussions'>('documents');
  const [selectedReviewContent, setSelectedReviewContent] = useState<string>('');
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [workspaceFilesTruncated, setWorkspaceFilesTruncated] = useState<boolean>(false);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<string>('');
  const [selectedWorkspaceFileContent, setSelectedWorkspaceFileContent] = useState<string>('');
  const [workspaceFileSearch, setWorkspaceFileSearch] = useState<string>('');
  const [highlightedDiscussionMessage, setHighlightedDiscussionMessage] = useState<number | null>(null);
  const [aiMembersSidebarExpanded, setAiMembersSidebarExpanded] = useState<boolean>(() => localStorage.getItem('room_ai_members_sidebar_expanded') === 'true');
  const [aiMemberDetailsExpanded, setAiMemberDetailsExpanded] = useState<boolean>(() => localStorage.getItem('room_ai_member_details_expanded') !== 'false');

  useEffect(() => {
    if (!projectPath || !contextPickerTarget) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setContextPickerLoading(true);
      try {
        const res = await window.electronAPI.searchContextItems(projectPath, contextPickerQuery);
        if (cancelled) return;
        if (res.success) {
          setContextPickerItems(res.items || []);
        } else {
          setContextPickerItems([]);
          setErrorMsg(res.error || 'Failed to search context.');
        }
      } catch (err: any) {
        if (!cancelled) {
          setContextPickerItems([]);
          setErrorMsg(err.message || 'Failed to search context.');
        }
      } finally {
        if (!cancelled) {
          setContextPickerLoading(false);
        }
      }
    }, contextPickerQuery.trim() ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectPath, contextPickerTarget, contextPickerQuery]);

  useEffect(() => {
    if (!projectPath || !isRoomProject || !projectData || onboardingSessionDismissed) return;
    const key = `room_onboarding_seen:${projectPath}`;
    const seen = localStorage.getItem(key) === 'true';
    setDismissedOnboarding(seen);
    if (!seen) {
      setOnboardingStep(0);
      setShowOnboardingTour(true);
    }
  }, [projectPath, isRoomProject, projectData, onboardingSessionDismissed]);

  useEffect(() => {
    if (!scanStartedAt) return;
    const messages = [
      'Scanning repository files and detecting project structure...',
      'Updating readable workspace overview and structure...',
      projectConfig.mainAgent && projectConfig.mainAgent !== 'none'
        ? 'Running the configured main agent to enrich the workspace overview...'
        : 'Refreshing workspace metadata...'
    ];
    setScanStatus(messages[0]);
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - scanStartedAt;
      const index = elapsed > 7000 ? 2 : elapsed > 2500 ? 1 : 0;
      setScanStatus(messages[index]);
    }, 500);
    return () => window.clearInterval(interval);
  }, [scanStartedAt, projectConfig.mainAgent]);

  // Fetch dynamic models when Main Workspace Agent changes in settings
  useEffect(() => {
    if (projectConfig.mainAgent && projectConfig.mainAgent !== 'none' && !dynamicCliModels[projectConfig.mainAgent]) {
      const fetchModels = async () => {
        try {
      const res = await window.electronAPI.detectCliModels(projectConfig.mainAgent);
      if (res.success && res.models && res.models.length > 0) {
        const models = res.models;
        setDynamicCliModels(prev => ({ ...prev, [projectConfig.mainAgent]: models }));
      }
        } catch (err) {
          console.error(`Failed to fetch models for settings main agent ${projectConfig.mainAgent}:`, err);
        }
      };
      fetchModels();
    }
  }, [projectConfig.mainAgent]);

  // Scan local CLI agents on mount
  useEffect(() => {
    const scanClis = async () => {
      try {
        const res = await window.electronAPI.detectLocalAgents();
        if (res.success && res.agents) {
          setDetectedClis(res.agents);
        }
      } catch (err) {
        console.error('Failed to detect local agents:', err);
      }
    };
    scanClis();
  }, []);

  const refreshProviders = async () => {
    const res = await window.electronAPI.loadProviders();
    if (res.success && res.providers) setProviders(res.providers);
  };

  useEffect(() => {
    refreshProviders();
  }, []);

  // Fetch dynamic models when Local CLI preset changes
  useEffect(() => {
    if (newAgentProvider === 'Local CLI' && newAgentPreset !== 'none' && !dynamicCliModels[newAgentPreset]) {
      const fetchModels = async () => {
        try {
          const res = await window.electronAPI.detectCliModels(newAgentPreset);
          if (res.success && res.models && res.models.length > 0) {
            const models = res.models;
            setDynamicCliModels(prev => ({ ...prev, [newAgentPreset]: models }));
          }
        } catch (err) {
          console.error('Failed to fetch CLI models:', err);
        }
      };
      fetchModels();
    }
  }, [newAgentProvider, newAgentPreset]);

  // Fetch dynamic models when API provider changes (Gemini, Claude, Codex)
  useEffect(() => {
    if (newAgentProvider && newAgentProvider !== 'Local CLI' && !dynamicCliModels[newAgentProvider]) {
      const fetchModels = async () => {
        try {
          const res = await window.electronAPI.detectApiModels(normalizeProviderId(newAgentProvider));
          if (res.success && res.models && res.models.length > 0) {
            const models = res.models;
            setDynamicCliModels(prev => ({ ...prev, [newAgentProvider]: models }));
            setNewAgentModel(current => {
              const currentTrimmed = current.trim();
              if (!currentTrimmed) return models[0].value;
              const hasCurrentModel = models.some(m => m.value === currentTrimmed);
              return hasCurrentModel ? current : models[0].value;
            });
          }
        } catch (err) {
          console.error(`Failed to fetch API models for ${newAgentProvider}:`, err);
        }
      };
      fetchModels();
    }
  }, [newAgentProvider]);

  // Auto-expand the newest cycle when a new one starts
  const maxRound = codingTaskMessages.length > 0 ? Math.max(...codingTaskMessages.map(m => m.round ?? 0)) : 0;
  useEffect(() => {
    if (maxRound > lastMaxRound) {
      setOpenRounds(prev => ({ ...prev, [maxRound]: true }));
      setLastMaxRound(maxRound);
    }
  }, [maxRound, lastMaxRound]);

  // User input topic and timeline state
  const [userInputTopic, setUserInputTopic] = useState<string>('');
  const [discussionMessages, setDiscussionMessages] = useState<UIMessage[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>('');

  const clearWorkspaceDerivedState = () => {
    setProjectData(null);
    setContextOverviewDraft('');
    setContextStructureDraft('');
    setWorkspaceFiles([]);
    setWorkspaceFilesTruncated(false);
    setSelectedWorkspaceFile('');
    setSelectedWorkspaceFileContent('');
    setWorkspaceFileSearch('');
    setDiscussionMessages([]);
    setCodingTaskMessages([]);
    setOpenRounds({});
    setExpandedMsgKeys({});
    setLastMaxRound(-1);
    setActiveDiscussionId(null);
    setLastDiscussionLog(null);
    setLastDiscussionTopic('');
    setLastCodingTaskResult(null);
    setSelectedDiscussionContextRefs(['workspace:overview', 'workspace:structure']);
    setSelectedCodingTaskContextRefs(['workspace:overview', 'workspace:structure']);
    setContextPickerTarget(null);
    setContextPickerItems([]);
    setShowOnboardingTour(false);
    setDismissedOnboarding(false);
    setOnboardingSessionDismissed(false);
    setHasCompletedScan(false);
    setScanStatus('');
    setScanStartedAt(null);
    setActiveTab('Discussions');
  };

  const addRecentProject = (pathStr: string) => {
    setRecentProjects(prev => {
      const filtered = prev.filter(p => p !== pathStr);
      const updated = [pathStr, ...filtered].slice(0, 5); // Keep up to 5 unique paths
      localStorage.setItem('recentProjects', JSON.stringify(updated));
      return updated;
    });
  };

  const handleOpenProject = async () => {
    setErrorMsg(null);
    try {
      const result = await window.electronAPI.selectProjectDir();
      if (!result) return;

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(result.isRoomProject);

      addRecentProject(result.path);

      if (result.isRoomProject) {
        await loadProjectData(result.path);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to open project.');
    }
  };

  const handleCreateWorkspace = async () => {
    const workspaceName = newWorkspaceName.trim();
    if (!workspaceName) {
      setErrorMsg('Workspace name is required.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await window.electronAPI.createWorkspace(workspaceName);
      if (!result) return;
      if (!result.success || !result.path) {
        setErrorMsg(result.error || 'Failed to create workspace.');
        return;
      }

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(true);
      setNewWorkspaceName('');
      addRecentProject(result.path);
      await loadProjectData(result.path);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecentProject = async (pathStr: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await window.electronAPI.openProjectDir(pathStr);
      if (!result) {
        throw new Error('Project directory could not be accessed.');
      }

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(result.isRoomProject);

      addRecentProject(result.path);

      if (result.isRoomProject) {
        await loadProjectData(result.path);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to open recent project. It might have been deleted or moved.');
      // Remove stale path from the list
      setRecentProjects(prev => {
        const filtered = prev.filter(p => p !== pathStr);
        localStorage.setItem('recentProjects', JSON.stringify(filtered));
        return filtered;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInitProject = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.roomInit(projectPath);
      if (res.success) {
        clearWorkspaceDerivedState();
        setIsRoomProject(true);
        addRecentProject(projectPath);
        setProjectPath(projectPath);
        await loadProjectData(projectPath);
      } else {
        setErrorMsg(res.error || 'Failed to initialize .room.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize project.');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseProjectWorkspace = () => {
    setProjectPath(null);
    setIsRoomProject(false);
    clearWorkspaceDerivedState();
  };

  const handleRoleChange = (roleValue: string) => {
    setNewAgentRole(roleValue);
  };

  const getModelOptions = (provider: string, preset?: string) => {
    if (provider === 'Local CLI') {
      if (preset && dynamicCliModels[preset] && dynamicCliModels[preset].length > 0) {
        return dynamicCliModels[preset];
      }
      if (preset && preset !== 'none') {
        return getFallbackModels(preset as 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy') as ModelOption[];
      }
      return [];
    }

    if (dynamicCliModels[provider] && dynamicCliModels[provider].length > 0) {
      return dynamicCliModels[provider];
    }

    const id = normalizeProviderId(provider);
    const fallbackKey = ({ gemini: 'Gemini', anthropic: 'Claude', openai: 'Codex' } as Record<string, string>)[id];
    if (fallbackKey) {
      return getFallbackModels(fallbackKey as 'Claude' | 'Gemini' | 'Codex') as ModelOption[];
    }
    if (providers.some(candidate => candidate.id === id)) {
      return []; // custom providers: discovered via detectApiModels or typed manually
    }

    return [];
  };

  const ensureTemplateSkills = async (skills: readonly TemplateSkill[]) => {
    if (!projectPath || skills.length === 0) return [];

    const existingSkills = new Set((projectData?.skills || []).map((skill: string) => skill.toLowerCase()));
    const savedSkillFiles: string[] = [];

    for (const skill of skills) {
      if (!existingSkills.has(skill.filename.toLowerCase())) {
        const content = `# ${skill.title}\n\n${skill.content.trim()}\n`;
        const res = await window.electronAPI.saveSkill(projectPath, skill.filename, content);
        if (!res.success) {
          throw new Error(res.error || `Failed to save ${skill.filename}.`);
        }
        existingSkills.add(skill.filename.toLowerCase());
      }

      savedSkillFiles.push(skill.filename);
    }

    return savedSkillFiles;
  };

  const resetAgentForm = () => {
    setNewAgentName('');
    setNewAgentRole('');
    setNewAgentProvider('gemini');
    setNewAgentModel('');
    setNewAgentModelCustom(false);
    setNewAgentCommand('');
    setNewAgentPrompt('');
    setNewAgentSkills([]);
    setNewAgentPreset('none');
    setNewAgentStdinFormat('text');
    setNewAgentPermissionMode('safe');
    setCustomSkillName('');
    setCustomSkillDesc('');
    setEditingSkillFile('');
    setEditingSkillContent('');
    setEditingSkillSource('skills');
    setSkillPreview(null);
    setEditingAgent(null);
  };

  const startEditAgent = (agent: any) => {
    setEditingAgent(agent);
    setNewAgentName(agent.name);
    setNewAgentRole(agent.role);
    setNewAgentProvider(normalizeProviderId(agent.provider));
    setNewAgentModel(agent.modelName || '');
    setNewAgentModelCustom(false);
    setNewAgentPrompt(agent.systemPrompt);
    setNewAgentSkills(agent.skills || []);
    setSkillPreview(null);
    setNewAgentPreset(agent.cliPreset || 'none');
    setNewAgentCommand(agent.command || '');
    setNewAgentStdinFormat(agent.stdinFormat || 'text');
    setNewAgentPermissionMode(agent.permissionMode || 'safe');
    setEditingSkillSource('skills');
    setActiveTab(`Agent:${agent.name}`);
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectPath || !newAgentName.trim() || !newAgentRole.trim() || !newAgentPrompt.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (editingAgent && editingAgent.name.toLowerCase() !== newAgentName.trim().toLowerCase()) {
        await window.electronAPI.deleteAgent(projectPath, editingAgent.name);
      }

      const defaultModel = getModelOptions(newAgentProvider, newAgentPreset)[0]?.value;
      const modelToSave = newAgentProvider === 'Local CLI'
        ? newAgentModel.trim() || undefined
        : newAgentModel.trim() || defaultModel;
      const permissionMode = newAgentProvider === 'Local CLI'
        ? (newAgentPreset === 'none' ? 'dangerous' : newAgentPermissionMode)
        : undefined;
      if (newAgentProvider === 'Local CLI') {
        if (newAgentPreset === 'none') {
          const confirmed = window.confirm('ROOM will execute this custom command from the workspace directory. Custom Local CLI agents require workspace dangerous mode. Continue?');
          if (!confirmed) return;
        } else if (permissionMode === 'dangerous') {
          const confirmed = window.confirm('Warning: This Local CLI preset will run with dangerous permissions enabled. Continue?');
          if (!confirmed) return;
        }
      }

      const res = await window.electronAPI.saveAgent(projectPath, {
        name: newAgentName.trim(),
        role: newAgentRole.trim(),
        provider: newAgentProvider,
        modelName: modelToSave,
        systemPrompt: newAgentPrompt,
        skills: newAgentSkills,
        command: newAgentProvider === 'Local CLI' ? (newAgentPreset === 'none' ? newAgentCommand : undefined) : undefined,
        cliPreset: newAgentProvider === 'Local CLI' ? newAgentPreset : undefined,
        stdinFormat: newAgentProvider === 'Local CLI' ? newAgentStdinFormat : undefined,
        permissionMode
      });
      if (res.success) {
        resetAgentForm();
        await loadProjectData(projectPath);
        setActiveTab('AI Members');
      } else {
        setErrorMsg(res.error || 'Failed to save custom agent.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving agent.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTeamPreset = async (presetName: string) => {
    if (!projectPath) return;
    const preset = teamPresets.find(team => team.name === presetName);
    if (!preset) return;

    const existingNames = new Set((projectData?.agents || []).map((agent: any) => String(agent.name).toLowerCase()));
    const templatesToAdd = preset.roles
      .map(roleName => agentPersonaTemplates.find(template => template.name === roleName))
      .filter((template): template is typeof agentPersonaTemplates[number] => !!template)
      .filter(template => !existingNames.has(template.name.toLowerCase()));

    if (templatesToAdd.length === 0) {
      setErrorMsg('All AI members in this team already exist in the workspace.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      for (const template of templatesToAdd) {
        const provider = normalizeProviderId(template.provider);
        const modelOptions = getModelOptions(provider, 'none');
        const defaultModel = modelOptions[0]?.value;
        const skillFiles = await ensureTemplateSkills(template.skills);
        const res = await window.electronAPI.saveAgent(projectPath, {
          name: template.name,
          role: template.role,
          provider,
          modelName: defaultModel,
          systemPrompt: template.prompt,
          skills: skillFiles
        });

        if (!res.success) {
          setErrorMsg(res.error || `Failed to add ${template.name}.`);
          return;
        }
      }

      await loadProjectData(projectPath);
      setSelectedDiscussionAgents(prev => Array.from(new Set([...prev, ...templatesToAdd.map(template => template.name)])));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to add team preset.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAgent = async (agentName: string) => {
    if (!projectPath) return;
    const confirmDelete = window.confirm(`Are you sure you want to delete the agent "${agentName}"?`);
    if (!confirmDelete) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.deleteAgent(projectPath, agentName);
      if (res.success) {
        await loadProjectData(projectPath);
        if (activeTab === `Agent:${agentName}`) {
          setActiveTab('AI Members');
          resetAgentForm();
        }
      } else {
        setErrorMsg(res.error || 'Failed to delete agent.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while deleting agent.');
    } finally {
      setLoading(false);
    }
  };

  const loadProjectData = async (pathStr: string) => {
    try {
      const data = await window.electronAPI.getProjectData(pathStr);
      if (data.success) {
        setHasCompletedScan(!!localStorage.getItem(`room_scan_completed:${pathStr}`) || !!data.hasScanData);
        setProjectData({
          projectMd: data.projectMd,
          archMd: data.archMd,
          hasScanData: data.hasScanData,
          tasks: data.tasks,
          decisions: data.decisions,
          reviews: data.reviews || [],
          documents: data.documents || [],
          discussions: data.discussions,
          skills: data.skills,
          agents: data.agents || []
        });
        setContextOverviewDraft(data.projectMd || '');
        setContextStructureDraft(data.archMd || '');

        // Initialize selected discussion agents list
        if (data.agents && data.agents.length > 0) {
          const names = data.agents.map((a: any) => a.name);
          setSelectedDiscussionAgents(prev => {
            const validPrev = prev.filter(name => names.includes(name));
            if (validPrev.length > 0) return validPrev;
            return names.slice(0, 2);
          });
          const developerCandidate = data.agents.find((agent: any) => {
            const text = `${agent.name} ${agent.role}`.toLowerCase();
            return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('coder');
          }) || data.agents[0];
          setCodingTaskDeveloperName(prev => names.includes(prev) ? prev : developerCandidate?.name || '');
          setCodingTaskReviewerNames(prev => {
            const validPrev = prev.filter(name => names.includes(name));
            if (validPrev.length > 0) return validPrev;
            return data.agents
              .filter((agent: any) => {
                const text = `${agent.name} ${agent.role}`.toLowerCase();
                return text.includes('review') || text.includes('senior') || text.includes('qa');
              })
              .map((agent: any) => agent.name)
              .slice(0, 2);
          });
        } else {
          setSelectedDiscussionAgents([]);
          setCodingTaskDeveloperName('');
          setCodingTaskReviewerNames([]);
        }

        try {
          const fileRes = await window.electronAPI.listWorkspaceFiles(pathStr);
          if (fileRes.success) {
            setWorkspaceFiles(fileRes.files || []);
            setWorkspaceFilesTruncated(!!fileRes.truncated);
          } else {
            setWorkspaceFiles([]);
            setWorkspaceFilesTruncated(false);
            setErrorMsg(fileRes.error || 'Failed to load workspace files.');
          }
        } catch (err) {
          console.error('Error loading workspace files:', err);
        }

        // Load MCP config
        try {
          const mcpRes = await window.electronAPI.loadMcpConfig(pathStr);
          if (mcpRes.success && mcpRes.config) {
            setMcpConfig(mcpRes.config);
          }
        } catch (err) {
          console.error('Error loading MCP configuration:', err);
        }

        // Load project config
        try {
          const configRes = await window.electronAPI.loadProjectConfig(pathStr);
          if (configRes.success && configRes.config) {
            setProjectConfig({
              mainAgent: configRes.config.mainAgent || 'none',
              modelName: configRes.config.modelName,
              allowDangerousCli: !!configRes.config.allowDangerousCli
            });
          }
        } catch (err) {
          console.error('Error loading project configuration:', err);
        }
        await loadTaskBoardCards(pathStr);
      } else {
        setErrorMsg(data.error || 'Failed to load project metadata.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error fetching project data.');
    }
  };

  const handleSaveMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectPath) return;

    const name = mcpServerName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!name) {
      setErrorMsg('Server name is required.');
      return;
    }

    if (!mcpServerCommand.trim()) {
      setErrorMsg('Command is required.');
      return;
    }

    setLoading(true);
    try {
      // Parse args
      let argsArray: string[] = [];
      if (mcpServerArgs.trim()) {
        argsArray = parseShellArgs(mcpServerArgs.trim());
      }

      // Parse env variables (KEY=VAL lines)
      const envObj: Record<string, string> = {};
      if (mcpServerEnv.trim()) {
        const lines = mcpServerEnv.trim().split('\n');
        for (const line of lines) {
          const parts = line.split('=');
          if (parts[0] && parts[0].trim()) {
            envObj[parts[0].trim()] = parts.slice(1).join('=').trim();
          }
        }
      }

      const updatedServers = { ...mcpConfig.mcpServers };
      
      // If we are renaming a server, delete the old key
      if (selectedMcpServer && selectedMcpServer !== 'New' && selectedMcpServer !== name) {
        delete updatedServers[selectedMcpServer];
      }

      updatedServers[name] = {
        command: mcpServerCommand.trim(),
        args: argsArray,
        ...(Object.keys(envObj).length > 0 ? { env: envObj } : {})
      };

      const newConfig = { mcpServers: updatedServers };
      const res = await window.electronAPI.saveMcpConfig(projectPath, newConfig);
      if (res.success) {
        setMcpConfig(newConfig);
        setSelectedMcpServer(name);
        setMcpServerName(name);
        setErrorMsg(null);
      } else {
        setErrorMsg(res.error || 'Failed to save MCP server.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving MCP server.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMcpServer = async (serverKey: string) => {
    if (!projectPath || !confirm(`Are you sure you want to delete MCP server "${serverKey}"?`)) return;

    setLoading(true);
    try {
      const updatedServers = { ...mcpConfig.mcpServers };
      delete updatedServers[serverKey];

      const newConfig = { mcpServers: updatedServers };
      const res = await window.electronAPI.saveMcpConfig(projectPath, newConfig);
      if (res.success) {
        setMcpConfig(newConfig);
        setSelectedMcpServer(null);
        resetMcpForm();
        setErrorMsg(null);
      } else {
        setErrorMsg(res.error || 'Failed to delete MCP server.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while deleting MCP server.');
    } finally {
      setLoading(false);
    }
  };

  const resetMcpForm = () => {
    setMcpServerName('');
    setMcpServerCommand('');
    setMcpServerArgs('');
    setMcpServerEnv('');
  };

  const handleSelectMcpServer = (key: string) => {
    setSelectedMcpServer(key);
    if (key === 'New') {
      resetMcpForm();
    } else {
      const srv = mcpConfig.mcpServers[key];
      setMcpServerName(key);
      setMcpServerCommand(srv.command || '');
      setMcpServerArgs(srv.args ? srv.args.join(' ') : '');
      let envStr = '';
      if (srv.env) {
        envStr = Object.entries(srv.env).map(([k, v]) => `${k}=${v}`).join('\n');
      }
      setMcpServerEnv(envStr);
    }
  };

  const triggerScan = async () => {
    if (!projectPath) return;
    const finishScanStatus = (message: string) => {
      setScanStartedAt(null);
      setScanStatus(message);
      window.setTimeout(() => {
        setScanStatus(current => current === message ? '' : current);
      }, 4000);
    };
    setLoading(true);
    setErrorMsg(null);
    setScanStartedAt(Date.now());
    setScanStatus('Starting repository scan...');
    try {
      const res = await window.electronAPI.runScan(projectPath, projectConfig.mainAgent, projectConfig.modelName, !!projectConfig.allowDangerousCli);
      if (!res.success) {
        finishScanStatus('Scan failed.');
        setErrorMsg(res.error || 'Scan failed.');
        return;
      }
      setScanStatus('Refreshing ROOM workspace data...');
      localStorage.setItem(`room_scan_completed:${projectPath}`, new Date().toISOString());
      setHasCompletedScan(true);
      await loadProjectData(projectPath);
      finishScanStatus('Scan complete. Workspace context is up to date.');
    } catch (err: any) {
      finishScanStatus('Scan failed.');
      setErrorMsg(err.message || 'Scan failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProjectConfig = async (key: keyof ProjectConfigState, value: string | boolean) => {
    if (!projectPath) return;
    const newConfig: ProjectConfigState = { ...projectConfig, [key]: value };
    if (key === 'mainAgent') {
      newConfig.modelName = '';
      newConfig.allowDangerousCli = false;
    }
    setProjectConfig(newConfig);
    try {
      await window.electronAPI.saveProjectConfig(projectPath, newConfig);
      if (key === 'mainAgent' && typeof value === 'string' && value !== 'none') {
        const res = await window.electronAPI.detectCliModels(value);
        if (res.success && res.models && res.models.length > 0) {
          const models = res.models;
          setDynamicCliModels(prev => ({ ...prev, [value]: models }));
          const updatedConfig = { ...newConfig, modelName: models[0].value };
          setProjectConfig(updatedConfig);
          await window.electronAPI.saveProjectConfig(projectPath, updatedConfig);
        }
      }
    } catch (err) {
      console.error('Failed to save project settings:', err);
    }
  };

  const handleSaveProviderKey = async (providerId: string) => {
    const draft = (providerKeyDrafts[providerId] || '').trim();
    if (!draft) return;
    const res = await window.electronAPI.saveProvider({ id: providerId, apiKey: draft });
    if (res.success && res.providers) {
      setProviders(res.providers);
      setProviderKeyDrafts(prev => ({ ...prev, [providerId]: '' }));
    } else if (res.error) {
      alert(res.error);
    }
  };

  const handleAddProvider = async () => {
    const id = addProviderDraft.id.trim().toLowerCase();
    const res = await window.electronAPI.saveProvider({
      id,
      label: addProviderDraft.label.trim() || id,
      baseUrl: addProviderDraft.baseUrl.trim(),
      apiKey: addProviderDraft.apiKey.trim() || undefined
    });
    if (res.success && res.providers) {
      setProviders(res.providers);
      setAddProviderOpen(false);
      setAddProviderDraft({ id: '', label: '', baseUrl: '', apiKey: '' });
    } else if (res.error) {
      alert(res.error);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    const usedBy = (projectData?.agents || []).filter((agent: any) => normalizeProviderId(agent.provider) === providerId).map((agent: any) => agent.name);
    const detail = usedBy.length > 0
      ? `\n\nUsed by: ${usedBy.join(', ')}. These members will fall back to Gemini until reassigned.`
      : '';
    if (!window.confirm(`Remove this provider?${detail}`)) return;
    const res = await window.electronAPI.deleteProvider(providerId);
    if (res.success && res.providers) setProviders(res.providers);
    else if (res.error) alert(res.error);
  };

  const handleTestProvider = async (providerId: string) => {
    setProviderTestResults(prev => ({ ...prev, [providerId]: { ok: true, message: 'Testing...' } }));
    const res = await window.electronAPI.testProvider(providerId);
    setProviderTestResults(prev => ({
      ...prev,
      [providerId]: res.success ? { ok: true, message: res.message || 'OK' } : { ok: false, message: res.error || 'Failed' }
    }));
  };

  const loadRoomFilePreview = async (
    section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions' | 'skills',
    filename: string
  ) => {
    if (!projectPath || !filename) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.readRoomFile(projectPath, section, filename);
      if (!res.success) {
        setErrorMsg(res.error || `Failed to load ${filename}.`);
        return;
      }

      if (section === 'decisions') {
        setSelectedDecisionFile(filename);
        setSelectedDecisionContent(res.content || '');
      } else if (section === 'tasks') {
        setSelectedTaskFile(filename);
        setSelectedTaskContent(res.content || '');
      } else if (section === 'documents') {
        setSelectedReviewFile(filename);
        setSelectedReviewSection(section);
        setSelectedReviewContent(res.content || '');
      } else if (section === 'skills') {
        setEditingSkillFile(filename);
        setEditingSkillContent(res.content || '');
        setEditingSkillSource(res.sourceSection === 'roles' ? 'roles' : 'skills');
      } else {
        setSelectedReviewFile(filename);
        setSelectedReviewSection(section);
        setSelectedReviewContent(res.content || '');
      }
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to load ${filename}.`);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaceFilePreview = async (filePath: string) => {
    if (!projectPath || !filePath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.readWorkspaceFile(projectPath, filePath);
      setSelectedWorkspaceFile(filePath);
      if (!res.success) {
        setSelectedWorkspaceFileContent(`# Cannot preview file\n\n${res.error || `Failed to load ${filePath}.`}`);
        return;
      }
      setSelectedWorkspaceFileContent(res.content || '');
    } catch (err: any) {
      setSelectedWorkspaceFile(filePath);
      setSelectedWorkspaceFileContent(`# Cannot preview file\n\n${err.message || `Failed to load ${filePath}.`}`);
    } finally {
      setLoading(false);
    }
  };

  const openContextPicker = (target: 'discussion' | 'task') => {
    setContextPickerTarget(target);
    setContextPickerQuery('');
    setContextPickerTab('Suggested');
  };

  const closeContextPicker = () => {
    setContextPickerTarget(null);
  };

  const getContextSelection = (target: 'discussion' | 'task') => (
    target === 'discussion' ? selectedDiscussionContextRefs : selectedCodingTaskContextRefs
  );

  const setContextSelection = (target: 'discussion' | 'task', refs: string[]) => {
    if (target === 'discussion') {
      setSelectedDiscussionContextRefs(refs);
    } else {
      setSelectedCodingTaskContextRefs(refs);
    }
  };

  const toggleContextSelection = (target: 'discussion' | 'task', ref: string) => {
    const selectedRefs = getContextSelection(target);
    setContextSelection(
      target,
      selectedRefs.includes(ref)
        ? selectedRefs.filter(item => item !== ref)
        : [...selectedRefs, ref]
    );
  };

  const getContextLabel = (ref: string) => {
    if (ref === 'workspace:overview') return 'Workspace Overview';
    if (ref === 'workspace:structure') return 'Workspace Structure';
    const known = contextPickerItems.find(item => item.ref === ref);
    if (known) return known.label;
    if (ref.startsWith('task:')) return `Task: ${ref.slice('task:'.length)}`;
    if (ref.startsWith('document:')) return `Doc: ${ref.slice('document:'.length)}`;
    if (ref.startsWith('discussion:')) return `Chat: ${ref.slice('discussion:'.length)}`;
    if (ref.startsWith('file:')) return `File: ${ref.slice('file:'.length)}`;
    return ref;
  };

  const getFilteredContextItems = () => {
    if (contextPickerTab === 'Tasks') {
      return contextPickerItems.filter(item => item.type === 'task' || /task|todo|plan|issue|bug|ticket|backlog/i.test(`${item.label} ${item.path || ''}`));
    }
    if (contextPickerTab === 'Docs') {
      return contextPickerItems.filter(item => item.type === 'doc' || item.type === 'workspace');
    }
    if (contextPickerTab === 'Files') {
      return contextPickerItems.filter(item => item.type === 'file');
    }
    return contextPickerItems;
  };

  const estimateContextTokens = (target: 'discussion' | 'task') => {
    const selectedRefs = getContextSelection(target);
    const bytes = selectedRefs.reduce((total, ref) => {
      const item = contextPickerItems.find(candidate => candidate.ref === ref);
      return total + (item?.size || 12000);
    }, 0);
    return Math.max(selectedRefs.length * 80, Math.round(bytes / 4));
  };

  const buildDiscussionSummaryMarkdown = () => {
    if (!lastDiscussionLog) return '';
    const messages = lastDiscussionLog.messages || [];
    return `# Discussion Summary: ${lastDiscussionLog.title || lastDiscussionTopic || 'Untitled'}

## Topic
${lastDiscussionLog.topic || lastDiscussionTopic || 'Untitled'}

## Status
${lastDiscussionLog.status || 'completed'}

## AI Members
${Array.from(new Set(messages.map((message: any) => message.agentName))).map(name => `- ${name}`).join('\n') || '- None'}

## Transcript
${messages.map((message: any, index: number) => `### ${index + 1}. ${message.agentName} (${message.providerName})

${message.content}`).join('\n\n')}
`;
  };

  const buildDiscussionTaskMarkdown = () => {
    if (!lastDiscussionLog) return '';
    return `# Follow-up Tasks: ${lastDiscussionLog.title || lastDiscussionTopic || 'Untitled'}

## Source Discussion
- Topic: ${lastDiscussionLog.topic || lastDiscussionTopic || 'Untitled'}
- Status: ${lastDiscussionLog.status || 'completed'}

## Tasks
- [ ] Review the discussion transcript.
- [ ] Extract concrete next actions.
- [ ] Assign owners or AI members.
- [ ] Decide which context or documents should be updated.

## Notes
This task note was created from a ROOM discussion. Refine it before treating it as the source of truth.
`;
  };

  const safeDocumentSlug = (input: string): string => {
    const slug = (input || 'discussion')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return slug || 'discussion';
  };

  const getSavedDocumentFilename = (text: string): string | null => {
    const match = text.match(/saved to Documents:\s*([^\n]+?\.md)\s*$/i);
    return match?.[1]?.trim() || null;
  };

  const formatAgentDisplayName = (agentName: string, providerName: string, modelName?: string): string => {
    const cleanModel = modelName?.trim();
    return cleanModel
      ? `${agentName} (${cleanModel})`
      : `${agentName} (${providerName})`;
  };

  const openDocumentFromBubble = async (filename: string) => {
    await loadRoomFilePreview('documents', filename);
    setActiveTab('Documents');
  };

  const getDiscussionIdFromFile = (filename: string) => filename.replace(/\.(md|json)$/i, '');

  const formatDiscussionLogMessages = (log: any): UIMessage[] => {
    const messages = Array.isArray(log?.messages) ? log.messages : [];
    let inferredRound = 1;
    const seenAgentsInRound = new Set<string>();

    return messages.map((message: any) => {
      if (message.type === 'user') {
        return {
          author: 'You',
          role: 'user',
          time: message.timestamp || '',
          text: message.content || '',
          round: 0
        };
      }

      let msgRound = message.round;
      if (msgRound === undefined) {
        const agentName = message.agentName || 'agent';
        if (seenAgentsInRound.has(agentName)) {
          inferredRound++;
          seenAgentsInRound.clear();
        }
        seenAgentsInRound.add(agentName);
        msgRound = inferredRound;
      }

      const contextCount = Array.isArray(message.contextMessages) ? message.contextMessages.length : 0;
      return {
        author: formatAgentDisplayName(message.agentName, message.providerName, message.modelName),
        role: String(message.agentName || 'agent').toLowerCase(),
        time: message.timestamp || '',
        text: message.content || '',
        round: msgRound,
        contextSummary: contextCount > 0
          ? `Context: ${contextCount} chat message${contextCount === 1 ? '' : 's'}`
          : 'Context: current message only'
      };
    });
  };

  const getAgentProgressMessage = (step = 0) => {
    const messages = [
      'Reading the workspace context...',
      'Reviewing the discussion so far...',
      'Planning the response...',
      'Checking details before answering...',
      'Preparing the final answer...'
    ];
    return messages[step % messages.length];
  };

  const advanceAgentProgressMessage = (message: UIMessage): UIMessage => {
    const nextStep = (message.progressStep || 0) + 1;
    return {
      ...message,
      text: getAgentProgressMessage(nextStep),
      progressStep: nextStep,
      streaming: true
    };
  };

  const decodeHtmlEntities = (value: string) => {
    if (!/[&]/.test(value) || typeof document === 'undefined') return value;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  };

  const normalizeMarkupForMarkdown = (value: string) => {
    return decodeHtmlEntities(value)
      .replace(/\r\n/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p\b[^>]*>/gi, '')
      .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) => `${'#'.repeat(Math.min(Number(level), 3))} ${body.trim()}\n\n`)
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n')
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  };

  const scrollToDiscussionMessage = (messageNumber: number) => {
    const element = document.getElementById(`discussion-message-${messageNumber}`);
    if (!element) return;
    setHighlightedDiscussionMessage(messageNumber);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      setHighlightedDiscussionMessage(current => current === messageNumber ? null : current);
    }, 1800);
  };

  const formatMathForDisplay = (value: string) => {
    let output = value
      .replace(/\\text\{([^{}]*)\}/g, '$1')
      .replace(/\\times/g, 'x')
      .replace(/\\%/g, '%')
      .replace(/\\left|\\right/g, '')
      .replace(/\\,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let previous = '';
    while (previous !== output) {
      previous = output;
      output = output.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1) / ($2)');
    }

    return output.replace(/[{}]/g, '').trim() || value.trim();
  };

  const renderMathInline = (value: string, key: string) => (
    <code
      key={key}
      style={{
        padding: '1px 5px',
        borderRadius: '6px',
        border: '1px solid hsl(var(--border-dim))',
        background: 'hsl(var(--bg-input))',
        color: 'hsl(var(--text-primary))',
        fontSize: '0.95em',
        whiteSpace: 'normal'
      }}
    >
      {formatMathForDisplay(value)}
    </code>
  );

  const renderMathBlock = (value: string, key: string) => (
    <pre
      key={key}
      style={{
        margin: '0 0 0.75em 0',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid hsl(var(--border-dim))',
        background: 'hsl(var(--bg-input))',
        color: 'hsl(var(--text-primary))',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.55
      }}
    >
      <code>{formatMathForDisplay(value)}</code>
    </pre>
  );

  const splitMarkdownTableRow = (line: string) => {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map(cell => cell.trim());
  };

  const isMarkdownTableSeparator = (line: string) => {
    const cells = splitMarkdownTableRow(line);
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  };

  const looksLikeMarkdownTableRow = (line: string) => {
    return line.includes('|') && splitMarkdownTableRow(line).length > 1;
  };

  const renderMarkdownTable = (tableLines: string[], key: string) => {
    const header = splitMarkdownTableRow(tableLines[0] || '');
    const rows = tableLines.slice(2)
      .map(splitMarkdownTableRow)
      .filter(row => row.some(cell => cell.length > 0));

    return (
      <div key={key} style={{ margin: '0 0 0.8em 0', overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          border: '1px solid hsl(var(--border-dim))',
          borderRadius: '8px',
          overflow: 'hidden',
          fontSize: '0.92em'
        }}>
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th
                  key={`th-${index}`}
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid hsl(var(--border-dim))',
                    background: 'hsl(var(--bg-input))',
                    color: 'hsl(var(--text-primary))',
                    textAlign: 'left',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {renderInlineMarkdown(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`tr-${rowIndex}`}>
                {header.map((_, cellIndex) => (
                  <td
                    key={`td-${rowIndex}-${cellIndex}`}
                    style={{
                      padding: '8px 10px',
                      borderTop: rowIndex === 0 ? 0 : '1px solid hsl(var(--border-dim) / 0.65)',
                      color: 'hsl(var(--text-secondary))',
                      verticalAlign: 'top'
                    }}
                  >
                    {renderInlineMarkdown(row[cellIndex] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const cleanGraphNodeLabel = (value: string) => {
    const withoutEdgeLabel = value.replace(/\|[^|]*\|/g, '').trim();
    const labelMatch = withoutEdgeLabel.match(/(?:\["?([^"\]]+)"?\]|\("?(.*?)"?\)|\{"?([^"}]+)"?\})/);
    if (labelMatch) return (labelMatch[1] || labelMatch[2] || labelMatch[3] || '').trim();
    return withoutEdgeLabel
      .replace(/^[A-Za-z0-9_.:-]+\s*/, '')
      .replace(/[";]/g, '')
      .trim() || withoutEdgeLabel.replace(/[";]/g, '').trim();
  };

  const parseGraphEdges = (value: string) => {
    return value.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('%%') && !/^(graph|flowchart|sequenceDiagram|stateDiagram|mindmap|timeline|gantt|pie)\b/i.test(line))
      .map(line => {
        const match = line.match(/^(.+?)\s*(-->|---|->|=>|--)\s*(.+)$/);
        if (!match) return null;
        return {
          from: cleanGraphNodeLabel(match[1]),
          arrow: match[2],
          to: cleanGraphNodeLabel(match[3])
        };
      })
      .filter((edge): edge is { from: string; arrow: string; to: string } => Boolean(edge));
  };

  const isGraphCodeBlock = (language: string, value: string) => {
    const normalizedLanguage = language.trim().toLowerCase();
    return ['mermaid', 'graph', 'flowchart', 'dot'].includes(normalizedLanguage)
      || /^(graph|flowchart|sequenceDiagram|stateDiagram|mindmap|timeline|gantt|pie)\b/i.test(value.trim());
  };

  const renderGraphBlock = (value: string, key: string) => {
    const edges = parseGraphEdges(value);
    return (
      <div
        key={key}
        style={{
          margin: '0 0 0.8em 0',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid hsl(var(--border-dim))',
          background: 'hsl(var(--bg-input))',
          overflowX: 'auto'
        }}
      >
        <div style={{ marginBottom: '8px', color: 'hsl(var(--text-primary))', fontWeight: 700, fontSize: '0.9em' }}>
          Graph
        </div>
        {edges.length > 0 ? (
          <div style={{ display: 'grid', gap: '7px', minWidth: '260px' }}>
            {edges.map((edge, index) => (
              <div
                key={`${edge.from}-${edge.to}-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(80px, max-content) max-content minmax(80px, max-content)',
                  gap: '8px',
                  alignItems: 'center',
                  color: 'hsl(var(--text-secondary))'
                }}
              >
                <span style={{ padding: '5px 8px', borderRadius: '7px', border: '1px solid hsl(var(--border-dim))', background: 'hsl(var(--bg-panel))' }}>{edge.from}</span>
                <span style={{ color: 'hsl(var(--text-muted))' }}>{edge.arrow.includes('>') ? '->' : '--'}</span>
                <span style={{ padding: '5px 8px', borderRadius: '7px', border: '1px solid hsl(var(--border-dim))', background: 'hsl(var(--bg-panel))' }}>{edge.to}</span>
              </div>
            ))}
          </div>
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'hsl(var(--text-secondary))' }}>{value}</pre>
        )}
      </div>
    );
  };

  const renderInlineMarkdown = (value: string) => {
    const nodes: React.ReactNode[] = [];
    const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`[^`]+`|\$(?!\$)[^$\n]+\$|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(value)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(value.slice(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith('[')) {
        const label = match[2];
        const href = match[3];
        const messageMatch = label.match(/^Message\s+(\d+)$/i);
        if (messageMatch) {
          const messageNumber = Number(messageMatch[1]);
          nodes.push(
            <button
              key={`inline-message-ref-${nodes.length}`}
              type="button"
              onClick={() => scrollToDiscussionMessage(messageNumber)}
              style={{ padding: 0, border: 0, background: 'none', color: 'hsl(var(--accent-blue))', cursor: 'pointer', font: 'inherit', fontWeight: 650, textDecoration: 'underline', textUnderlineOffset: '2px' }}
              title={`Jump to ${label}`}
            >
              {label}
            </button>
          );
        } else if (href.startsWith('file://')) {
          nodes.push(<span key={`inline-file-link-${nodes.length}`} style={{ color: 'hsl(var(--accent-blue))', fontWeight: 650 }}>{label}</span>);
        } else {
          nodes.push(
            <a key={`inline-link-${nodes.length}`} href={href} target="_blank" rel="noreferrer">
              {label}
            </a>
          );
        }
      } else if (token.startsWith('`')) {
        nodes.push(<code key={`inline-code-${nodes.length}`}>{token.slice(1, -1)}</code>);
      } else if (token.startsWith('$')) {
        nodes.push(renderMathInline(token.slice(1, -1), `inline-math-${nodes.length}`));
      } else if (token.startsWith('**')) {
        nodes.push(<strong key={`inline-strong-${nodes.length}`}>{token.slice(2, -2)}</strong>);
      } else {
        nodes.push(<em key={`inline-em-${nodes.length}`}>{token.slice(1, -1)}</em>);
      }
      lastIndex = match.index + token.length;
    }

    if (lastIndex < value.length) {
      nodes.push(value.slice(lastIndex));
    }
    return nodes.length > 0 ? nodes : value;
  };

  const renderMarkdownContent = (text: string, streaming?: boolean, className = 'message-markdown') => {
    const content = normalizeMarkupForMarkdown(text || (streaming ? 'Waiting for output...' : ''));
    const lines = content.split('\n');
    const blocks: React.ReactNode[] = [];
    let paragraph: string[] = [];
    let listItems: string[] = [];
    let codeLines: string[] = [];
    let mathLines: string[] = [];
    let inCode = false;
    let inMath = false;
    let codeLanguage = '';
    let codeIndex = 0;
    let mathIndex = 0;
    let tableIndex = 0;

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const value = paragraph.join('\n');
      blocks.push(
        <p key={`p-${blocks.length}`} style={{ margin: '0 0 0.65em 0', whiteSpace: 'pre-wrap' }}>
          {renderInlineMarkdown(value)}
        </p>
      );
      paragraph = [];
    };

    const flushList = () => {
      if (listItems.length === 0) return;
      blocks.push(
        <ul key={`ul-${blocks.length}`} style={{ margin: '0 0 0.75em 1.15em', padding: 0 }}>
          {listItems.map((item, index) => (
            <li key={`${item}-${index}`} style={{ marginBottom: '0.25em' }}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    };

    const flushCode = () => {
      const value = codeLines.join('\n');
      if (isGraphCodeBlock(codeLanguage, value)) {
        blocks.push(renderGraphBlock(value, `graph-${codeIndex++}`));
      } else {
        blocks.push(
          <pre key={`code-${codeIndex++}`} style={{
            margin: '0 0 0.75em 0',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid hsl(var(--border-dim))',
            background: 'hsl(var(--bg-input))',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
            <code>{value}</code>
          </pre>
        );
      }
      codeLines = [];
      codeLanguage = '';
    };

    const flushMath = () => {
      if (mathLines.length === 0) return;
      blocks.push(renderMathBlock(mathLines.join('\n'), `math-${mathIndex++}`));
      mathLines = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim().startsWith('```')) {
        flushParagraph();
        flushList();
        if (inCode) {
          flushCode();
        } else {
          codeLanguage = line.trim().slice(3).trim().split(/\s+/)[0] || '';
        }
        inCode = !inCode;
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (inMath) {
        const closeIndex = line.indexOf('$$');
        if (closeIndex >= 0) {
          const beforeClose = line.slice(0, closeIndex).trim();
          if (beforeClose) mathLines.push(beforeClose);
          flushMath();
          inMath = false;
          const remainder = line.slice(closeIndex + 2).trim();
          if (remainder) paragraph.push(remainder);
        } else {
          mathLines.push(line);
        }
        continue;
      }

      const mathStart = line.trim();
      if (mathStart.startsWith('$$')) {
        flushParagraph();
        flushList();
        const afterOpen = mathStart.slice(2);
        const closeIndex = afterOpen.indexOf('$$');
        if (closeIndex >= 0) {
          const inlineMath = afterOpen.slice(0, closeIndex).trim();
          if (inlineMath) {
            mathLines.push(inlineMath);
            flushMath();
          }
          const remainder = afterOpen.slice(closeIndex + 2).trim();
          if (remainder) paragraph.push(remainder);
        } else {
          const initialMath = afterOpen.trim();
          if (initialMath) mathLines.push(initialMath);
          inMath = true;
        }
        continue;
      }

      if (
        looksLikeMarkdownTableRow(line)
        && index + 1 < lines.length
        && isMarkdownTableSeparator(lines[index + 1])
      ) {
        flushParagraph();
        flushList();
        const tableLines = [line, lines[index + 1]];
        index += 1;
        while (index + 1 < lines.length && looksLikeMarkdownTableRow(lines[index + 1])) {
          tableLines.push(lines[index + 1]);
          index += 1;
        }
        blocks.push(renderMarkdownTable(tableLines, `table-${tableIndex++}`));
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        const level = headingMatch[1].length;
        blocks.push(
          <div key={`h-${blocks.length}`} style={{
            margin: blocks.length === 0 ? '0 0 0.5em 0' : '0.85em 0 0.5em 0',
            color: 'white',
            fontWeight: 700,
            fontSize: level === 1 ? '1.04em' : level === 2 ? '0.98em' : '0.92em'
          }}>
            {renderInlineMarkdown(headingMatch[2])}
          </div>
        );
        continue;
      }

      const bulletMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
      if (bulletMatch) {
        flushParagraph();
        listItems.push(bulletMatch[1]);
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }

      flushList();
      paragraph.push(line);
    }

    if (inCode || codeLines.length > 0) flushCode();
    if (inMath || mathLines.length > 0) flushMath();
    flushParagraph();
    flushList();

    return <div className={className}>{blocks.length > 0 ? blocks : content}</div>;
  };

  const startNewDiscussion = () => {
    setActiveDiscussionId(null);
    setLastDiscussionLog(null);
    setLastDiscussionTopic('');
    setDiscussionMessages([]);
  };

  const loadTaskBoardCards = async (dirPath: string) => {
    try {
      const res = await window.electronAPI.loadTaskBoard(dirPath);
      if (res.success && res.cards) {
        setTaskBoardCards(res.cards);
      } else if (!res.success && res.error) {
        setErrorMsg(`Failed to load Task Board: ${res.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to load Task Board: ${err.message}`);
    }
  };

  const loadDiscussionSession = async (filename: string) => {
    if (!projectPath) return;
    const discussionId = getDiscussionIdFromFile(filename);
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.readRoomFile(projectPath, 'discussions', `${discussionId}.json`);
      if (!res.success || !res.content) {
        setErrorMsg(res.error || `Failed to load ${filename}.`);
        return;
      }

      const log = JSON.parse(res.content);
      setActiveDiscussionId(log.id || discussionId);
      setLastDiscussionLog(log);
      setLastDiscussionTopic(log.topic || '');
      setDiscussionMessages(formatDiscussionLogMessages(log));
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to load ${filename}.`);
    } finally {
      setLoading(false);
    }
  };

  const saveDiscussionOutput = async (section: 'documents' | 'tasks') => {
    if (!projectPath || !lastDiscussionLog) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const discussionId = lastDiscussionLog.id || activeDiscussionId;
    const titleSource = lastDiscussionLog.topic || lastDiscussionLog.title || lastDiscussionTopic || discussionId || 'discussion';
    const filename = section === 'documents'
      ? discussionId
        ? `${safeDocumentSlug(titleSource)}-${discussionId}-summary.md`
        : `discussion-${timestamp}-summary.md`
      : `discussion-${timestamp}-tasks.md`;
    const content = section === 'documents'
      ? buildDiscussionSummaryMarkdown()
      : buildDiscussionTaskMarkdown();

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.saveRoomFile(projectPath, section, filename, content);
      if (!res.success) {
        setErrorMsg(res.error || `Failed to save ${filename}.`);
        return;
      }
      await loadProjectData(projectPath);
      setActiveTab(section === 'documents' ? 'Documents' : 'Tasks');
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to save ${filename}.`);
    } finally {
      setLoading(false);
    }
  };

  const summarizeActiveDiscussion = async () => {
    if (!projectPath || !activeDiscussionId) {
      setErrorMsg('Select or run a chat before summarizing it.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.summarizeDiscussion(projectPath, activeDiscussionId, {
        agentNames: selectedDiscussionAgents,
        summaryAgentName: discussionSummaryAgentName !== '__project__' ? discussionSummaryAgentName : undefined,
        useProjectSummaryAgent: discussionSummaryAgentName === '__project__'
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to summarize chat.');
        return;
      }

      await loadProjectData(projectPath);
      if (res.filename) {
        await loadRoomFilePreview('documents', res.filename);
      }
      setActiveTab('Documents');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to summarize chat.');
    } finally {
      setLoading(false);
    }
  };

  const generateTasksFromActiveDiscussion = async () => {
    if (!projectPath || !activeDiscussionId) {
      setErrorMsg('Run or select a chat before generating tasks.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.generateTasksFromDiscussion(projectPath, activeDiscussionId, {
        moderatorName: discussionModeratorName || undefined
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to generate tasks.');
        return;
      }

      await loadProjectData(projectPath);
      setActiveTab('Tasks');

      if (res.createdTaskCards && res.createdTaskCards.length === 0) {
        setErrorMsg('All tasks from this discussion are already present on the task board.');
      } else if (res.errors && res.errors.length > 0) {
        setErrorMsg(`Generated tasks with warnings:\n\n` + res.errors.join('\n'));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate tasks.');
    } finally {
      setLoading(false);
    }
  };

  const handleRunCodingTask = async () => {
    if (!projectPath || !codingTaskInput.trim()) return;
    if (!codingTaskDeveloperName) {
      setErrorMsg('Select a Doer AI member before running the task.');
      return;
    }
    if (codingTaskReviewerNames.length === 0) {
      setErrorMsg('Select at least one Reviewer or Lead member.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setLastCodingTaskResult(null);
    setOpenRounds({ 0: true });
    setExpandedMsgKeys({});
    setLastMaxRound(0);
    const task = codingTaskInput.trim();
    setCodingTaskInput('');
    setCodingTaskMessages([
      {
        author: 'You',
        role: 'user',
        time: new Date().toLocaleTimeString(),
        text: task,
        round: 0
      },
      {
        author: 'System Engine',
        role: 'system',
        time: new Date().toLocaleTimeString(),
        text: `Starting ${taskRunType} task with ${codingTaskDeveloperName}, then review by ${codingTaskReviewerNames.join(', ')}.`,
        round: 0
      }
    ]);

    const messageId = (taskId: string, round: number, agentName: string) => `${taskId}:${round}:${agentName}`;
    const unsubscribe = window.electronAPI.onDiscussionEvent((event) => {
      if (!event.discussionId.startsWith('task-')) return;

      if (event.type === 'agent_started') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setCodingTaskMessages(prev => [
          ...prev,
          {
            id,
            author: formatAgentDisplayName(event.agentName, event.providerName, event.modelName),
            role: event.agentName.toLowerCase(),
            time: event.timestamp,
            text: getAgentProgressMessage(0),
            streaming: true,
            progressStep: 0,
            round: event.round,
            contextSummary: `Cycle ${event.round} • ${event.role}`
          }
        ]);
        return;
      }

      if (event.type === 'agent_chunk') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setCodingTaskMessages(prev => {
          let found = false;
          const updated = prev.map(msg => {
            if (msg.id !== id) return msg;
            found = true;
            return advanceAgentProgressMessage(msg);
          });
          if (found) return updated;
          return [
            ...updated,
            {
              id,
              author: formatAgentDisplayName(event.agentName, event.providerName, event.modelName),
              role: event.agentName.toLowerCase(),
              time: new Date().toLocaleTimeString(),
              text: getAgentProgressMessage(0),
              streaming: true,
              progressStep: 0,
              round: event.round
            }
          ];
        });
        return;
      }

      if (event.type === 'message_completed') {
        const id = messageId(event.discussionId, event.round, event.message.agentName);
        const contextCount = event.message.contextMessages?.length || 0;
        setCodingTaskMessages(prev => {
          let found = false;
          const updated = prev.map(msg => {
            if (msg.id !== id) return msg;
            found = true;
            return {
              ...msg,
              text: event.message.content,
              time: event.message.timestamp,
              streaming: false,
              progressStep: undefined,
              round: event.round,
              contextSummary: `Cycle ${event.round} • Context: ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
            };
          });
          if (found) return updated;
          return [
            ...updated,
            {
              id,
              author: formatAgentDisplayName(event.message.agentName, event.message.providerName, event.message.modelName),
              role: event.message.agentName.toLowerCase(),
              time: event.message.timestamp,
              text: event.message.content,
              streaming: false,
              progressStep: undefined,
              round: event.round,
              contextSummary: `Cycle ${event.round} • Context: ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
            }
          ];
        });
        return;
      }

      if (event.type === 'agent_error') {
        setErrorMsg(`${event.agentName} failed: ${event.error}`);
        return;
      }

      if (event.type === 'discussion_failed') {
        setErrorMsg(event.error);
      }
    });

    try {
      const res = await window.electronAPI.runTask(projectPath, task, {
        taskType: taskRunType,
        doerName: codingTaskDeveloperName,
        reviewerNames: codingTaskReviewerNames,
        maxCycles: codingTaskMaxCycles,
        contextRefs: selectedCodingTaskContextRefs
      });
      if (!res.success || !res.result) {
        setErrorMsg(res.error || 'Failed to run task.');
        return;
      }

      setLastCodingTaskResult(res.result);
      setCodingTaskMessages([
        ...formatDiscussionLogMessages({ messages: res.result.messages }),
        {
          author: 'System Engine',
          role: 'system',
          time: new Date().toLocaleTimeString(),
          round: res.result.cycles,
          text: res.result.status === 'approved'
            ? `Task approved after ${res.result.cycles} cycle(s). Transcript: ${res.result.markdownFilename}. Artifact: ${res.result.artifactFilename || 'none'}`
            : `Task still needs revision after ${res.result.cycles} cycle(s). Transcript: ${res.result.markdownFilename}. Artifact: ${res.result.artifactFilename || 'none'}`
        }
      ]);
      await loadProjectData(projectPath);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to run task.');
    } finally {
      unsubscribe();
      setLoading(false);
    }
  };

  const applyTaskTypePreset = (taskType: string) => {
    setTaskRunType(taskType);
    const agents = projectData?.agents || [];
    if (agents.length === 0) return;

    const findByTerms = (terms: string[]) => agents.find((agent: any) => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return terms.some(term => text.includes(term));
    });
    const findManyByTerms = (terms: string[]) => agents
      .filter((agent: any) => {
        const text = `${agent.name} ${agent.role}`.toLowerCase();
        return terms.some(term => text.includes(term));
      })
      .map((agent: any) => agent.name);

    const mapping: Record<string, { doer: string[]; reviewers: string[] }> = {
      coding: {
        doer: ['developer', 'implementer', 'engineer', 'coder'],
        reviewers: ['reviewer', 'senior', 'qa', 'security']
      },
      writing: {
        doer: ['writer', 'screenwriter', 'editorial'],
        reviewers: ['editor', 'reviewer', 'producer']
      },
      film: {
        doer: ['screenwriter', 'writer'],
        reviewers: ['story editor', 'editor', 'producer']
      },
      research: {
        doer: ['researcher', 'research'],
        reviewers: ['reviewer', 'producer', 'analyst']
      },
      business: {
        doer: ['product', 'producer', 'analyst'],
        reviewers: ['reviewer', 'researcher', 'producer']
      },
      design: {
        doer: ['ux', 'designer', 'design'],
        reviewers: ['product', 'reviewer', 'qa']
      },
      general: {
        doer: ['producer', 'product', 'researcher', 'developer', 'writer'],
        reviewers: ['reviewer', 'editor', 'qa', 'producer']
      }
    };

    const preset = mapping[taskType] || mapping.general;
    const doer = findByTerms(preset.doer) || agents[0];
    const reviewers = findManyByTerms(preset.reviewers)
      .filter((name: string) => name !== doer.name)
      .slice(0, 3);
    setCodingTaskDeveloperName(doer.name);
    setCodingTaskReviewerNames(reviewers.length > 0 ? reviewers : agents.filter((agent: any) => agent.name !== doer.name).slice(0, 2).map((agent: any) => agent.name));
  };

  const saveContextDrafts = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const overviewRes = await window.electronAPI.saveContextFile(projectPath, 'overview.md', contextOverviewDraft);
      if (!overviewRes.success) {
        setErrorMsg(overviewRes.error || 'Failed to save workspace overview.');
        return;
      }

      const structureRes = await window.electronAPI.saveContextFile(projectPath, 'structure.md', contextStructureDraft);
      if (!structureRes.success) {
        setErrorMsg(structureRes.error || 'Failed to save workspace structure.');
        return;
      }

      await loadProjectData(projectPath);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save workspace context.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendDiscussion = async () => {
    if (!userInputTopic.trim() || !projectPath) return;
    const availableAgentNames = new Set((projectData?.agents || []).map((agent: any) => agent.name));
    const validSelectedAgents = selectedDiscussionAgents.filter(name => availableAgentNames.has(name));
    if (selectedDiscussionAgents.length === 0) {
      setErrorMsg('Please select at least one participating agent.');
      return;
    }
    if (validSelectedAgents.length === 0) {
      setErrorMsg('Selected agents are not available in this workspace.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    const userTopic = userInputTopic;
    const contextRefs = selectedDiscussionContextRefs;
    setUserInputTopic('');
    setLastDiscussionLog(null);
    setLastDiscussionTopic(userTopic);
    const userMessage: UIMessage = {
      author: 'You',
      role: 'user',
      time: new Date().toLocaleTimeString(),
      text: userTopic
    };

    setDiscussionMessages(prev => [
      ...prev,
      userMessage,
      {
        author: 'System Engine',
        role: 'system',
        time: new Date().toLocaleTimeString(),
        text: `Initializing ${validSelectedAgents.join(' ↔ ')} workflow for topic: "${userTopic}"...`
      }
    ]);

    const messageId = (discussionId: string, round: number, agentName: string) => `${discussionId}:${round}:${agentName}`;
    const unsubscribe = window.electronAPI.onDiscussionEvent((event) => {
      if (event.type === 'agent_started') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setDiscussionMessages(prev => [
          ...prev,
          {
            id,
            author: formatAgentDisplayName(event.agentName, event.providerName, event.modelName),
            role: event.agentName.toLowerCase(),
            time: event.timestamp,
            text: getAgentProgressMessage(0),
            streaming: true,
            progressStep: 0
          }
        ]);
        return;
      }

      if (event.type === 'agent_chunk') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setDiscussionMessages(prev => {
          let found = false;
          const updated = prev.map((msg) => {
            if (msg.id !== id) return msg;
            found = true;
            return {
              ...advanceAgentProgressMessage(msg)
            };
          });

          if (found) return updated;

          return [
            ...updated,
            {
              id,
              author: formatAgentDisplayName(event.agentName, event.providerName, event.modelName),
              role: event.agentName.toLowerCase(),
              time: new Date().toLocaleTimeString(),
              text: getAgentProgressMessage(0),
              streaming: true,
              progressStep: 0
            }
          ];
        });
        return;
      }

      if (event.type === 'message_completed') {
        const id = messageId(event.discussionId, event.round, event.message.agentName);
        const contextCount = event.message.contextMessages?.length || 0;
        const contextSummary = contextCount > 0
          ? `Context: topic + ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
          : 'Context: topic only';
        setDiscussionMessages(prev => {
          let found = false;
          const updated = prev.map((msg) => {
            if (msg.id !== id) return msg;
            found = true;
            return {
              ...msg,
              text: event.message.content,
              time: event.message.timestamp,
              streaming: false,
              progressStep: undefined,
              contextSummary
            };
          });

          if (found) return updated;

          return [
            ...updated,
            {
              id,
              author: formatAgentDisplayName(event.message.agentName, event.message.providerName, event.message.modelName),
              role: event.message.agentName.toLowerCase(),
              time: event.message.timestamp,
              text: event.message.content,
              streaming: false,
              progressStep: undefined,
              contextSummary
            }
          ];
        });
        return;
      }

      if (event.type === 'agent_error') {
        setErrorMsg(`${event.agentName} failed: ${event.error}`);
        return;
      }

      if (event.type === 'discussion_failed') {
        setErrorMsg(event.error);
      }
    });

    try {
      const res = await window.electronAPI.runDiscussion(projectPath, userTopic, validSelectedAgents, {
        reviewMode: discussionReviewMode,
        maxRounds: discussionReviewMode ? discussionMaxRounds : 1,
        contextRefs,
        discussionId: activeDiscussionId || undefined,
        qualityGate: discussionQualityGate,
        moderatorName: discussionModeratorName || undefined,
        autoSummary: discussionAutoSummary,
        summaryAgentName: discussionSummaryAgentName !== '__project__' ? discussionSummaryAgentName : undefined,
        useProjectSummaryAgent: discussionSummaryAgentName === '__project__'
      });
      if (res.success && res.log) {
        setLastDiscussionLog(res.log);
        setLastDiscussionTopic(userTopic);
        setActiveDiscussionId(res.log.id);
        const formatted = formatDiscussionLogMessages(res.log);
        const statusMessage = discussionReviewMode && res.log.status === 'approved'
          ? [{
              author: 'System Engine',
              role: 'system',
              time: new Date().toLocaleTimeString(),
              text: 'Review loop completed: output passed the active gate.'
            }]
          : [];
        const actionMessages = (res.moderatorActions || []).map(action => ({
          author: 'System Engine',
          role: 'system',
          time: new Date().toLocaleTimeString(),
          text: action.type === 'task'
            ? `Moderator created task card ${action.id}: ${action.title}`
            : `Moderator created ${action.filename}`
        }));
        const summaryMessage = res.summary?.filename
          ? [{
              author: 'System Engine',
              role: 'system',
              time: new Date().toLocaleTimeString(),
              text: `Auto Summary saved to Documents: ${res.summary.filename}`
            }]
          : [];
        setDiscussionMessages([...formatted, ...statusMessage, ...actionMessages, ...summaryMessage]);
        await loadProjectData(projectPath);
      } else {
        setErrorMsg(res.error || 'Failed to complete discussion execution. Check API credentials.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to run agent workflow.');
    } finally {
      unsubscribe();
      setLoading(false);
    }
  };

  const handleAddCustomSkill = async () => {
    if (!projectPath || !customSkillName.trim()) return;
    const rawName = customSkillName.trim();
    const rawDesc = customSkillDesc.trim();
    const formattedName = rawName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const filename = `${formattedName}.md`;
    const defaultContent = `# ${rawName} Skill\n\n${rawDesc || 'Instructions and rules for ' + rawName + '.'}\n`;
    
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.saveSkill(projectPath, filename, defaultContent);
      if (res.success) {
        setCustomSkillName('');
        setCustomSkillDesc('');
        setEditingSkillFile(filename);
        setEditingSkillContent(defaultContent);
        setEditingSkillSource('skills');
        await loadProjectData(projectPath);
        setNewAgentSkills(prev => [...prev, filename]);
      } else {
        setErrorMsg(res.error || 'Failed to save skill.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving skill.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEditingSkill = async () => {
    if (!projectPath || !editingSkillFile.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.saveSkill(projectPath, editingSkillFile, editingSkillContent);
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to save skill.');
        return;
      }
      await loadProjectData(projectPath);
      setNewAgentSkills(prev => prev.includes(editingSkillFile) ? prev : [...prev, editingSkillFile]);
      setSkillPreview(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving skill.');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewAgentSkills = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.previewAgentSkills(projectPath, {
        provider: newAgentProvider,
        cliPreset: newAgentProvider === 'Local CLI' ? newAgentPreset : undefined,
        stdinFormat: newAgentProvider === 'Local CLI' ? newAgentStdinFormat : undefined,
        skills: newAgentSkills
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to check skills.');
        return;
      }
      setSkillPreview({
        delivery: res.delivery || 'Skills are sent as Active Skills in the agent instructions.',
        readableCount: res.readableCount || 0,
        totalCount: res.totalCount || 0,
        items: res.items || []
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while checking skills.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendDiscussion();
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const menuItems = [
    { name: 'Overview', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
    )},
    { name: 'Files', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 13h8M8 16h5" /></svg>
    )},
    { name: 'AI Members', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    )},
    { name: 'Discussions', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
    )},
    { name: 'Task Run', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 8l-4 4 4 4" /></svg>
    )},
    { name: 'Documents', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    )},
    { name: 'Tasks', label: 'Task Archive', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
    )},
    { name: 'Context', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
    )},
    { name: 'MCP Servers', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5M6.75 16.5h10.5M9 7.5v9m6-9v9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 4.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 013.75 9V6a1.5 1.5 0 011.5-1.5zM15.75 4.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5zM5.25 13.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5V15a1.5 1.5 0 011.5-1.5zM15.75 13.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5V15a1.5 1.5 0 011.5-1.5z" />
      </svg>
    )},
    { name: 'Settings', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    )}
  ];

  const renderContextControl = (target: 'discussion' | 'task', title: string) => {
    const selectedRefs = getContextSelection(target);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 14px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
            {title}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
            {selectedRefs.length} selected · ~{estimateContextTokens(target).toLocaleString()} tokens
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => openContextPicker(target)}
            style={{ padding: '8px 12px', fontSize: '0.78rem' }}
          >
            Add Context
          </button>
          {selectedRefs.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={() => setContextSelection(target, [])}
              style={{ padding: '8px 12px', fontSize: '0.78rem' }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '86px', overflowY: 'auto' }}>
          {selectedRefs.length === 0 ? (
            <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))' }}>
              No additional context selected.
            </span>
          ) : selectedRefs.map(ref => (
            <button
              key={ref}
              type="button"
              disabled={loading}
              onClick={() => toggleContextSelection(target, ref)}
              title={getContextLabel(ref)}
              className="skill-checkbox-chip selected"
              style={{ fontSize: '0.72rem', padding: '4px 10px', borderRadius: '14px', maxWidth: '280px' }}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ✓ {getContextLabel(ref)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderContextPickerPanel = () => {
    if (!contextPickerTarget) return null;
    const selectedRefs = getContextSelection(contextPickerTarget);
    const filteredItems = getFilteredContextItems();
    const tabs: Array<typeof contextPickerTab> = ['Suggested', 'Tasks', 'Docs', 'Files'];

    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 80,
          background: 'rgba(3, 5, 12, 0.84)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '28px'
        }}
      >
        <div style={{
          width: 'min(1080px, 100%)',
          height: 'min(720px, calc(100vh - 56px))',
          background: 'hsl(var(--bg-main))',
          border: '1px solid hsl(var(--border-dim))',
          borderRadius: '8px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 300px',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          isolation: 'isolate'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid hsl(var(--border-dim))', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 700 }}>Add Context</div>
                <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', marginTop: '3px' }}>
                  Search project tasks, docs, and files without loading the whole workspace into the picker.
                </div>
              </div>
              <button type="button" className="btn-secondary" onClick={closeContextPicker} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Close
              </button>
            </div>

            <div style={{ padding: '14px 18px', borderBottom: '1px solid hsl(var(--border-dim))', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="search"
                autoFocus
                value={contextPickerQuery}
                onChange={(e) => setContextPickerQuery(e.target.value)}
                placeholder="Search tasks, docs, paths, filenames..."
                style={{
                  width: '100%',
                  height: '40px',
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '0 12px',
                  color: 'white',
                  fontFamily: 'inherit',
                  outline: 'none'
                }}
              />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {tabs.map(tab => (
                  <button
                    key={tab}
                    type="button"
                    className={contextPickerTab === tab ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setContextPickerTab(tab)}
                    style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {contextPickerLoading ? (
                <div style={{ color: 'hsl(var(--text-muted))', padding: '24px 4px', fontSize: '0.86rem' }}>Searching context...</div>
              ) : filteredItems.length === 0 ? (
                <div style={{ color: 'hsl(var(--text-muted))', padding: '24px 4px', fontSize: '0.86rem' }}>No matching context found.</div>
              ) : filteredItems.map(item => {
                const selected = selectedRefs.includes(item.ref);
                return (
                  <button
                    key={`${item.ref}-${item.path || item.label}`}
                    type="button"
                    onClick={() => toggleContextSelection(contextPickerTarget, item.ref)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '22px minmax(0, 1fr) auto',
                      gap: '10px',
                      alignItems: 'center',
                      width: '100%',
                      minHeight: '58px',
                      background: selected ? 'hsl(var(--accent-purple) / 0.14)' : 'hsl(var(--bg-card))',
                      border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'inherit',
                      textAlign: 'left',
                      font: 'inherit',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '4px',
                      border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                      background: selected ? 'hsl(var(--accent-purple))' : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.72rem'
                    }}>
                      {selected ? '✓' : ''}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.86rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.label}
                      </span>
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.detail}
                      </span>
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>
                      {item.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ borderLeft: '1px solid hsl(var(--border-dim))', background: 'hsl(var(--bg-sidebar))', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ padding: '16px', borderBottom: '1px solid hsl(var(--border-dim))' }}>
              <div style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>Selected Context</div>
              <div style={{ fontSize: '0.76rem', color: 'hsl(var(--text-secondary))', marginTop: '4px' }}>
                {selectedRefs.length} items · ~{estimateContextTokens(contextPickerTarget).toLocaleString()} tokens
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {selectedRefs.length === 0 ? (
                <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.82rem', lineHeight: 1.45 }}>Selected items will appear here before they are attached.</div>
              ) : selectedRefs.map(ref => (
                <button
                  key={ref}
                  type="button"
                  onClick={() => toggleContextSelection(contextPickerTarget, ref)}
                  title={getContextLabel(ref)}
                  style={{
                    border: '1px solid hsl(var(--border-dim))',
                    background: 'hsl(var(--bg-card))',
                    color: 'inherit',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    textAlign: 'left',
                    font: 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getContextLabel(ref)}</div>
                  <div style={{ fontSize: '0.68rem', color: 'hsl(var(--text-muted))', marginTop: '3px' }}>Click to remove</div>
                </button>
              ))}
            </div>
            <div style={{ padding: '14px', borderTop: '1px solid hsl(var(--border-dim))', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setContextSelection(contextPickerTarget, [])} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Clear
              </button>
              <button type="button" className="btn-primary" onClick={closeContextPicker} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Attach
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const onboardingSteps = [
    {
      title: 'ROOM starts with shared project memory',
      body: 'Keep a short workspace overview and attach the files, notes, or documents that should guide discussions, tasks, and decisions.',
      action: 'Open Context',
      run: () => setActiveTab('Context')
    },
    {
      title: 'AI Members are reusable teammates',
      body: 'Create role-based agents from templates, choose a provider, assign skills, and check that the selected skills can be delivered.',
      action: 'Open AI Members',
      run: () => setActiveTab('AI Members')
    },
    {
      title: 'Skills are reusable instructions',
      body: 'Skills are Markdown files. You can edit them, assign them to agents, and use Check Skills to confirm they will be sent at runtime.',
      action: 'Create Agent',
      run: () => {
        resetAgentForm();
        setActiveTab('Agent:New');
      }
    },
    {
      title: 'Context Picker keeps large repos manageable',
      body: 'Use Add Context in Discussions or Task Run to attach the docs, tasks, and files that should become the evidence trail for the run.',
      action: 'Open Discussions',
      run: () => setActiveTab('Discussions')
    },
    {
      title: 'Runs leave a traceable trail',
      body: 'Give one agent the work, choose reviewers, and let ROOM keep the message references, created tasks, ADRs, and artifacts connected.',
      action: 'Open Task Run',
      run: () => setActiveTab('Task Run')
    }
  ];

  const markOnboardingSeen = () => {
    if (projectPath) {
      localStorage.setItem(`room_onboarding_seen:${projectPath}`, 'true');
    }
    setDismissedOnboarding(true);
    setOnboardingSessionDismissed(true);
    setShowOnboardingTour(false);
  };

  const isPlaceholderContext = (content?: string) => {
    const normalized = (content || '').trim();
    if (!normalized) return true;
    return normalized.includes('Describe what this workspace is for.') ||
      normalized.includes('Describe the important parts of this workspace and how they relate to each other.');
  };

  const hasUsefulContext = (hasCompletedScan || !!projectData?.hasScanData) && !!projectData && (
    !isPlaceholderContext(projectData.projectMd) ||
    !isPlaceholderContext(projectData.archMd)
  );

  const setupItems = [
    {
      label: 'Review workspace context',
      done: hasUsefulContext,
      action: 'Open',
      run: () => setActiveTab('Context')
    },
    {
      label: 'Create AI member',
      done: (projectData?.agents || []).length > 0,
      action: 'Open',
      run: () => setActiveTab('AI Members')
    },
    {
      label: 'Add or edit skills',
      done: (projectData?.skills || []).length > 0,
      action: 'Edit',
      run: () => {
        resetAgentForm();
        setActiveTab('Agent:New');
      }
    },
    {
      label: 'Attach useful context',
      done: selectedDiscussionContextRefs.length > 2 || selectedCodingTaskContextRefs.length > 2,
      action: 'Pick',
      run: () => openContextPicker(activeTab === 'Task Run' ? 'task' : 'discussion')
    },
    {
      label: 'Create a traceable run',
      done: discussionMessages.length > 0 || codingTaskMessages.length > 0 || (projectData?.discussions || []).length > 0 || (projectData?.tasks || []).length > 0,
      action: 'Start',
      run: () => setActiveTab('Discussions')
    }
  ];

  const renderSetupChecklist = () => {
    if (dismissedOnboarding) return null;
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: '16px',
        alignItems: 'start',
        background: 'hsl(var(--bg-card))',
        border: '1px solid hsl(var(--border-dim))',
        borderRadius: '8px',
        padding: '14px 16px',
        marginBottom: '20px'
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'white' }}>Workspace setup</div>
          <div style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', marginTop: '3px' }}>
            Use this as a quick path from empty workspace to useful runs with source context and references preserved.
          </div>
          {scanStatus && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '10px',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid hsl(var(--accent-purple) / 0.28)',
              background: 'hsl(var(--accent-purple) / 0.08)',
              color: 'hsl(var(--text-secondary))',
              fontSize: '0.76rem'
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '999px',
                background: scanStartedAt ? 'hsl(var(--accent-purple))' : '#10b981',
                boxShadow: scanStartedAt ? '0 0 0 4px hsl(var(--accent-purple) / 0.12)' : 'none',
                flexShrink: 0
              }} />
              <span>{scanStatus}</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginTop: '12px' }}>
            {setupItems.map(item => (
              <button
                key={item.label}
                type="button"
                disabled={loading}
                onClick={item.run}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '18px minmax(0, 1fr) auto',
                  gap: '8px',
                  alignItems: 'center',
                  background: item.done ? 'rgba(16, 185, 129, 0.08)' : 'hsl(var(--bg-input))',
                  border: item.done ? '1px solid rgba(16, 185, 129, 0.28)' : '1px solid hsl(var(--border-dim))',
                  color: 'inherit',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  textAlign: 'left',
                  font: 'inherit',
                  cursor: loading ? 'default' : 'pointer'
                }}
              >
                <span style={{ color: item.done ? '#10b981' : 'hsl(var(--text-muted))' }}>{item.done ? '✓' : '○'}</span>
                <span style={{ fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                <span style={{ fontSize: '0.68rem', color: 'hsl(var(--accent-purple))', fontWeight: 700 }}>{item.action}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={() => { setOnboardingStep(0); setShowOnboardingTour(true); }} style={{ padding: '7px 11px', fontSize: '0.76rem' }}>
            Tour
          </button>
          <button type="button" className="btn-secondary" onClick={markOnboardingSeen} style={{ padding: '7px 11px', fontSize: '0.76rem' }}>
            Hide
          </button>
        </div>
      </div>
    );
  };

  const renderOnboardingTour = () => {
    if (!showOnboardingTour) return null;
    const step = onboardingSteps[onboardingStep] || onboardingSteps[0];
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 90,
          background: 'rgba(3, 5, 12, 0.84)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '28px'
        }}
      >
        <div style={{
          width: 'min(560px, 100%)',
          background: 'hsl(var(--bg-main))',
          border: '1px solid hsl(var(--border-dim))',
          borderRadius: '8px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          padding: '22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          isolation: 'isolate'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 800 }}>
                Quick tour {onboardingStep + 1}/{onboardingSteps.length}
              </div>
              <h3 style={{ margin: '6px 0 0', fontSize: '1.15rem', color: 'white' }}>{step.title}</h3>
            </div>
            <button type="button" className="btn-secondary" onClick={markOnboardingSeen} style={{ padding: '6px 10px', fontSize: '0.74rem' }}>
              Skip
            </button>
          </div>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'hsl(var(--text-secondary))', lineHeight: 1.55 }}>
            {step.body}
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            {onboardingSteps.map((_, index) => (
              <span
                key={index}
                style={{
                  height: '4px',
                  flex: 1,
                  borderRadius: '999px',
                  background: index <= onboardingStep ? 'hsl(var(--accent-purple))' : 'hsl(var(--border-dim))'
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={onboardingStep === 0}
              onClick={() => setOnboardingStep(stepIndex => Math.max(0, stepIndex - 1))}
              style={{ padding: '8px 12px', fontSize: '0.78rem' }}
            >
              Back
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  markOnboardingSeen();
                  step.run();
                }}
                style={{ padding: '8px 12px', fontSize: '0.78rem' }}
              >
                {step.action}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (onboardingStep >= onboardingSteps.length - 1) {
                    markOnboardingSeen();
                  } else {
                    setOnboardingStep(stepIndex => stepIndex + 1);
                  }
                }}
                style={{ padding: '8px 12px', fontSize: '0.78rem' }}
              >
                {onboardingStep >= onboardingSteps.length - 1 ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMainTab = () => {
    if (activeTab === 'Discussions') {
      const getAlignment = (role: string, idx: number) => {
        if (role === 'system') return 'center';
        if (role.includes('architect')) return 'flex-start';
        if (role.includes('reviewer')) return 'flex-end';
        return idx % 2 === 0 ? 'flex-start' : 'flex-end';
      };

      const discussionFiles = (projectData?.discussions || [])
        .filter(file => file.toLowerCase().endsWith('.md'))
        .sort((a, b) => b.localeCompare(a));

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 16px', background: 'hsl(var(--bg-sidebar))', borderRadius: '12px', border: '1px solid hsl(var(--border-dim))', marginBottom: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
                  Chat History
                </div>
                <div style={{ fontSize: '0.76rem', color: 'hsl(var(--text-secondary))', marginTop: '3px' }}>
                  {activeDiscussionId ? `Continuing ${activeDiscussionId}` : 'New chat'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" type="button" onClick={summarizeActiveDiscussion} disabled={loading || !activeDiscussionId} style={{ padding: '7px 12px', fontSize: '0.78rem' }}>
                  Summarize Chat
                </button>
                <button className="btn-secondary" type="button" onClick={startNewDiscussion} disabled={loading} style={{ padding: '7px 12px', fontSize: '0.78rem' }}>
                  New Chat
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '74px', overflowY: 'auto' }}>
              {discussionFiles.length === 0 ? (
                <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))' }}>No saved chats yet.</span>
              ) : (
                discussionFiles.slice(0, 12).map(file => {
                  const discussionId = getDiscussionIdFromFile(file);
                  const selected = activeDiscussionId === discussionId;
                  return (
                    <button
                      key={file}
                      type="button"
                      className="btn-secondary"
                      disabled={loading}
                      onClick={() => loadDiscussionSession(file)}
                      title={file}
                      style={{
                        padding: '5px 10px',
                        fontSize: '0.72rem',
                        height: 'auto',
                        borderRadius: '14px',
                        maxWidth: '240px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        borderColor: selected ? 'hsl(var(--accent-purple))' : undefined,
                        background: selected ? 'hsl(var(--accent-purple) / 0.14)' : undefined
                      }}
                    >
                      {selected ? '✓ ' : ''}
                      {file}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {discussionMessages.length === 0 ? (
              <div className="markdown-preview" style={{ maxHeight: 'none', minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem', textAlign: 'center' }}>
                <div style={{ color: 'white', fontWeight: 700 }}>Start with a question, plan, or review request.</div>
                <div style={{ maxWidth: '520px', lineHeight: 1.45 }}>
                  Add context when the answer depends on docs, tasks, or specific files. ROOM will preserve the discussion transcript, message references, and moderator-created tasks or ADRs.
                </div>
                <button type="button" className="btn-secondary" disabled={loading} onClick={() => openContextPicker('discussion')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                  Add Context
                </button>
              </div>
            ) : discussionMessages.map((msg, idx) => {
              const alignment = getAlignment(msg.role, idx);
              const savedDocumentFilename = msg.role === 'system' ? getSavedDocumentFilename(msg.text) : null;
              return (
                <div
                  key={idx}
                  id={`discussion-message-${idx + 1}`}
                  className={`chat-bubble ${msg.role}`}
                  style={{
                    alignSelf: alignment,
                    borderStyle: msg.role === 'system' ? 'dashed' : 'solid',
                    borderColor: highlightedDiscussionMessage === idx + 1
                      ? 'hsl(var(--accent-blue))'
                      : msg.role === 'system'
                        ? 'hsl(var(--accent-orange) / 0.5)'
                        : undefined,
                    boxShadow: highlightedDiscussionMessage === idx + 1 ? '0 0 0 2px hsl(var(--accent-blue) / 0.24)' : undefined,
                    maxWidth: msg.role === 'system' ? '90%' : '80%',
                    scrollMarginBlock: '80px'
                  }}
                >
	                  <div className="bubble-meta">
	                    <span className="bubble-author">{msg.author}</span>
	                    <span>{msg.streaming ? 'Working...' : msg.time}</span>
	                  </div>
	                  {renderMarkdownContent(msg.text, msg.streaming)}
                  {savedDocumentFilename && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={loading}
                        onClick={() => openDocumentFromBubble(savedDocumentFilename)}
                        style={{ padding: '5px 10px', fontSize: '0.72rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                      >
                        Open Document
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: '24px' }}>
            {renderContextControl('discussion', 'Context Picker')}
          </div>

          {/* Dynamic Agent Selector */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px 16px', background: 'hsl(var(--bg-sidebar))', borderRadius: '12px', border: '1px solid hsl(var(--border-dim))', marginTop: '8px', marginBottom: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase', marginRight: '4px' }}>
              AI Members:
            </span>
            {(projectData?.agents || []).length === 0 ? (
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>No AI members registered.</span>
            ) : (
              (projectData?.agents || []).map((agent: any) => {
                const isSelected = selectedDiscussionAgents.includes(agent.name);
                return (
                  <label 
                    key={agent.name} 
                    className={`skill-checkbox-chip ${isSelected ? 'selected' : ''}`}
                    style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: '16px' }}
                  >
                    <input 
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedDiscussionAgents(prev => 
                          prev.includes(agent.name) 
                            ? prev.filter(name => name !== agent.name) 
                            : [...prev, agent.name]
                        );
                      }}
                    />
                    {isSelected ? '✓ ' : '+ '}
                    {agent.name}
                  </label>
                );
              })
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '10px 16px', background: 'hsl(var(--bg-input))', borderRadius: '8px', border: '1px solid hsl(var(--border-dim))', marginBottom: '8px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={discussionReviewMode}
                disabled={loading}
                onChange={(e) => setDiscussionReviewMode(e.target.checked)}
              />
              Resolve over rounds
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
              Max rounds
              <select
                className="form-select"
                value={discussionMaxRounds}
                disabled={loading || !discussionReviewMode}
                onChange={(e) => setDiscussionMaxRounds(Number(e.target.value))}
                style={{ height: '30px', minWidth: '72px', fontSize: '0.78rem', padding: '0 8px' }}
              >
                {[2, 4, 6, 8, 10].map(rounds => (
                  <option key={rounds} value={rounds}>{rounds}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={discussionQualityGate}
                disabled={loading}
                onChange={(e) => setDiscussionQualityGate(e.target.checked)}
              />
              Quality Gate
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
              Moderator
              <select
                className="form-select"
                value={discussionModeratorName}
                disabled={loading || !discussionQualityGate}
                onChange={(e) => setDiscussionModeratorName(e.target.value)}
                style={{ height: '30px', minWidth: '150px', fontSize: '0.78rem', padding: '0 8px' }}
              >
                <option value="">Auto-pick</option>
                {(projectData?.agents || []).map((agent: any) => (
                  <option key={agent.name} value={agent.name}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={discussionAutoSummary}
                disabled={loading}
                onChange={(e) => setDiscussionAutoSummary(e.target.checked)}
              />
              Auto Summary
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
              Summary agent
              <select
                className="form-select"
                value={discussionSummaryAgentName}
                disabled={loading}
                onChange={(e) => setDiscussionSummaryAgentName(e.target.value)}
                style={{ height: '30px', minWidth: '180px', fontSize: '0.78rem', padding: '0 8px' }}
              >
                <option value="__project__">
                  {projectConfig.mainAgent && projectConfig.mainAgent !== 'none'
                    ? `Project settings: ${projectConfig.mainAgent}`
                    : 'Project settings'}
                </option>
                {(projectData?.agents || []).map((agent: any) => (
                  <option key={agent.name} value={agent.name}>{agent.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input
              type="text"
              value={userInputTopic}
              onChange={(e) => setUserInputTopic(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Ask selected agents to discuss an idea, plan, script, research question, or implementation..."
              style={{
                flex: 1,
                backgroundColor: 'hsl(var(--bg-input))',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '8px',
                padding: '12px 16px',
                color: 'white',
                fontFamily: 'inherit',
                outline: 'none'
              }}
            />
            <button className="btn-primary" onClick={handleSendDiscussion} disabled={loading} style={{ padding: '12px 24px' }}>
              {loading ? 'Running...' : 'Send'}
            </button>
          </div>

          {lastDiscussionLog && !loading && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', marginTop: '12px' }}>
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginRight: '4px' }}>
                Extract outputs
              </span>
              <button className="btn-secondary" type="button" onClick={() => saveDiscussionOutput('documents')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Save Summary to Documents
              </button>
              <button className="btn-secondary" type="button" onClick={() => saveDiscussionOutput('tasks')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Create Task Note
              </button>
              <button className="btn-secondary" type="button" onClick={generateTasksFromActiveDiscussion} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Generate Tasks (AI)
              </button>
              <button className="btn-secondary" type="button" onClick={() => setShowInspector(prev => !prev)} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                {showInspector ? 'Hide Inspector' : 'Inspector'}
              </button>
            </div>
          )}

          {showInspector && lastDiscussionLog && !loading && (
            <div style={{ marginTop: '12px', background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '14px 16px', maxHeight: '320px', overflowY: 'auto' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
                Discussion Inspector — who used what
              </div>
              {(lastDiscussionLog.messages || []).map((message: any, index: number) => {
                if (message.type === 'user') {
                  return (
                    <div key={index} style={{ fontSize: '0.85rem', fontWeight: 600, padding: '4px 0' }}>
                      ● {message.agentName} (user)
                    </div>
                  );
                }
                const refs = Array.isArray(message.references) ? message.references : [];
                const contextCount = Array.isArray(message.contextMessages) ? message.contextMessages.length : 0;
                return (
                  <div key={index} style={{ marginLeft: '14px', padding: '4px 0' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {message.agentName} ({message.providerName})
                    </div>
                    {refs.length > 0 ? (
                      refs.map((ref: any, refIndex: number) => (
                        <div key={refIndex} style={{ marginLeft: '14px', fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>
                          ↳ used {ref.author}{ref.reason ? ` — ${ref.reason}` : ''}
                        </div>
                      ))
                    ) : (
                      <div style={{ marginLeft: '14px', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                        ↳ no explicit references recorded ({contextCount} context message{contextCount === 1 ? '' : 's'} received)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (activeTab === 'Task Run') {
      const agents = projectData?.agents || [];
      const savedTaskRuns = (projectData?.tasks || []).slice(0, 12);
      const taskRunMessagesByRound: Record<number, UIMessage[]> = {};
      codingTaskMessages.forEach(msg => {
        const r = msg.round ?? 0;
        if (!taskRunMessagesByRound[r]) {
          taskRunMessagesByRound[r] = [];
        }
        taskRunMessagesByRound[r].push(msg);
      });
      const taskRunRounds = Object.keys(taskRunMessagesByRound).map(Number).sort((a, b) => a - b);
      const selectedDoer = agents.find((agent: any) => agent.name === codingTaskDeveloperName);
      const selectedTaskTypeLabel = taskTypeOptions.find(option => option.value === taskRunType)?.label || 'Custom';
      const currentRunTitle = codingTaskInput.trim() || 'Draft run';
      const canRunCodingTask = !loading && codingTaskInput.trim() && codingTaskDeveloperName && codingTaskReviewerNames.length > 0;
      const taskRunTabs: Array<{ id: 'setup' | 'timeline' | 'artifact' | 'trace'; label: string; count?: number }> = [
        { id: 'setup', label: 'Setup' },
        { id: 'timeline', label: 'Timeline', count: codingTaskMessages.length || undefined },
        { id: 'artifact', label: 'Artifact', count: lastCodingTaskResult?.artifactFilename ? 1 : undefined },
        { id: 'trace', label: 'Trace' }
      ];

      const runStatusText = loading ? 'running' : lastCodingTaskResult?.status || 'draft';
      const runStatusColor = lastCodingTaskResult?.status === 'approved'
        ? '#10b981'
        : lastCodingTaskResult
          ? 'hsl(var(--accent-orange))'
          : loading
            ? 'hsl(var(--accent-purple))'
            : 'hsl(var(--text-muted))';

      const setupPanel = (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.05fr) minmax(280px, 0.95fr)', gap: '18px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                Task Type
              </label>
              <select
                className="form-select"
                value={taskRunType}
                disabled={loading}
                onChange={(e) => applyTaskTypePreset(e.target.value)}
                style={{ height: '36px', fontSize: '0.85rem' }}
              >
                {taskTypeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                Work Request
              </label>
              <textarea
                value={codingTaskInput}
                onChange={(e) => setCodingTaskInput(e.target.value)}
                disabled={loading}
                placeholder="Describe the work you want the selected AI member to produce..."
                rows={10}
                style={{
                  width: '100%',
                  minHeight: '220px',
                  resize: 'vertical',
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  color: 'white',
                  fontFamily: 'inherit',
                  outline: 'none',
                  lineHeight: 1.5
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 14px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
                Doer
                <select
                  className="form-select"
                  value={codingTaskDeveloperName}
                  disabled={loading}
                  onChange={(e) => setCodingTaskDeveloperName(e.target.value)}
                  style={{ height: '36px', fontSize: '0.85rem' }}
                >
                  <option value="">Select Doer</option>
                  {agents.map((agent: any) => (
                    <option key={agent.name} value={agent.name}>{agent.name} - {agent.role}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
                  Reviewers / Leads
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '112px', overflowY: 'auto' }}>
                  {agents.map((agent: any) => {
                    const selected = codingTaskReviewerNames.includes(agent.name);
                    const disabled = loading || agent.name === codingTaskDeveloperName;
                    return (
                      <label
                        key={agent.name}
                        className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                        style={{ fontSize: '0.74rem', padding: '4px 10px', borderRadius: '14px', opacity: disabled && !selected ? 0.55 : 1 }}
                        title={`${agent.name} - ${agent.role}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => {
                            setCodingTaskReviewerNames(prev =>
                              prev.includes(agent.name)
                                ? prev.filter(name => name !== agent.name)
                                : [...prev, agent.name]
                            );
                          }}
                        />
                        {selected ? '✓ ' : '+ '}
                        {agent.name}
                      </label>
                    );
                  })}
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
                Review cycles
                <select
                  className="form-select"
                  value={codingTaskMaxCycles}
                  disabled={loading}
                  onChange={(e) => setCodingTaskMaxCycles(Number(e.target.value))}
                  style={{ height: '32px', minWidth: '72px', fontSize: '0.8rem', padding: '0 8px' }}
                >
                  {[1, 2, 3, 4, 5].map(cycles => (
                    <option key={cycles} value={cycles}>{cycles}</option>
                  ))}
                </select>
              </label>
            </div>

            {renderContextControl('task', 'Task Context')}

            <button
              className="btn-primary"
              type="button"
              onClick={() => {
                setTaskRunView('timeline');
                handleRunCodingTask();
              }}
              disabled={!canRunCodingTask}
              style={{ height: '42px', justifyContent: 'center' }}
            >
              {loading ? 'Running Task...' : 'Run Doer -> Review Loop'}
            </button>
          </div>
        </div>
      );

      const timelinePanel = (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', paddingRight: '6px' }}>
          {codingTaskMessages.length === 0 ? (
            <div className="markdown-preview" style={{ maxHeight: 'none', height: '100%', minHeight: '420px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem', textAlign: 'center' }}>
              <div style={{ color: 'white', fontWeight: 700 }}>No task run yet.</div>
              <div style={{ maxWidth: '520px', lineHeight: 1.45 }}>
                Create a run from Setup. The timeline keeps doer output, reviewer feedback, message references, and final status together.
              </div>
              <button type="button" className="btn-secondary" disabled={loading} onClick={() => setTaskRunView('setup')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
                Open Setup
              </button>
            </div>
          ) : (
            taskRunRounds.map(r => {
              const msgs = taskRunMessagesByRound[r];
              const isOpen = openRounds[r] ?? false;
              const roundTitle = r === 0 ? 'Setup & Requirements' : `Cycle ${r}`;
              const roundSubtitle = r === 0
                ? 'Initial prompt and system startup'
                : (() => {
                    const roundAgents = Array.from(new Set(msgs.filter(m => m.role !== 'system' && m.role !== 'user').map(m => m.author)));
                    return roundAgents.length > 0 ? `Participants: ${roundAgents.join(', ')}` : 'Agent running...';
                  })();

              return (
                <div
                  key={r}
                  style={{
                    background: 'hsl(var(--bg-card) / 0.25)',
                    border: '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: isOpen ? '0 4px 16px rgba(0, 0, 0, 0.2)' : 'none'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenRounds(prev => ({ ...prev, [r]: !prev[r] }))}
                    className="accordion-header"
                    style={{
                      padding: '12px 16px',
                      background: isOpen ? 'hsl(var(--bg-sidebar))' : 'transparent',
                      border: 0,
                      borderBottom: isOpen ? '1px solid hsl(var(--border-dim))' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      userSelect: 'none',
                      textAlign: 'left',
                      color: 'inherit'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: isOpen ? 'white' : 'hsl(var(--text-secondary))', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{roundTitle}</span>
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'hsl(var(--accent-purple) / 0.15)', color: 'hsl(var(--accent-purple))', fontWeight: 600 }}>
                          {msgs.length} message{msgs.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {roundSubtitle}
                      </div>
                    </div>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease', color: 'hsl(var(--text-muted))', flex: '0 0 auto' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'hsl(var(--bg-app) / 0.2)' }}>
                      {msgs.map((msg, idx) => {
                        const msgKey = `${msg.id || msg.author}-${r}-${idx}`;
                        const isLong = msg.text.length > 1200;
                        const isMsgExpanded = expandedMsgKeys[msgKey] ?? false;
                        let overlayBg = 'hsl(var(--bg-card))';
                        if (msg.role === 'system') overlayBg = 'hsl(var(--bg-app))';
                        else if (idx % 2 !== 0) overlayBg = 'hsl(var(--bg-card) / 0.7)';

                        return (
                          <div
                            key={msgKey}
                            className={`chat-bubble ${msg.role}`}
                            style={{
                              alignSelf: msg.role === 'system' ? 'center' : idx % 2 === 0 ? 'flex-start' : 'flex-end',
                              borderStyle: msg.role === 'system' ? 'dashed' : 'solid',
                              borderColor: msg.role === 'system' ? 'hsl(var(--accent-orange) / 0.5)' : undefined,
                              maxWidth: msg.role === 'system' ? '92%' : '86%',
                              display: 'flex',
                              flexDirection: 'column'
                            }}
                          >
                            <div className="bubble-meta">
                              <span className="bubble-author">{msg.author}</span>
                              <span>{msg.streaming ? 'Working...' : msg.time}</span>
                            </div>
                            <div style={{ position: 'relative', minWidth: 0 }}>
                              <div style={{ maxHeight: isLong && !isMsgExpanded ? '320px' : 'none', overflow: 'hidden', position: 'relative', transition: 'max-height 0.25s ease' }}>
                                {renderMarkdownContent(msg.text, msg.streaming)}
                                {isLong && !isMsgExpanded && (
                                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px', background: `linear-gradient(to bottom, transparent, ${overlayBg})`, pointerEvents: 'none' }} />
                                )}
                              </div>
                              {isLong && (
                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
                                  <button type="button" className="btn-secondary" onClick={() => setExpandedMsgKeys(prev => ({ ...prev, [msgKey]: !isMsgExpanded }))} style={{ padding: '4px 10px', fontSize: '0.72rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    {isMsgExpanded ? 'Collapse message' : `Show full output (${Math.round(msg.text.length / 100) / 10} KB)`}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      );

      const artifactPanel = (
        <div className="markdown-preview" style={{ maxHeight: 'none', minHeight: '420px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
            <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Status</div>
              <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{lastCodingTaskResult?.status || (loading ? 'running' : 'not started')}</div>
            </div>
            <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Cycles</div>
              <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{lastCodingTaskResult?.cycles ?? taskRunRounds.filter(r => r > 0).length}</div>
            </div>
            <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Approved By</div>
              <div style={{ marginTop: '4px', color: 'white', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lastCodingTaskResult?.approvedBy?.length ? lastCodingTaskResult.approvedBy.join(', ') : 'Pending'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Artifact</div>
            <div style={{ color: 'white', fontWeight: 650, wordBreak: 'break-word' }}>
              {lastCodingTaskResult?.artifactFilename || 'No artifact has been produced yet.'}
            </div>
            {lastCodingTaskResult?.statusSummary && (
              <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.84rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {lastCodingTaskResult.statusSummary}
              </div>
            )}
          </div>

          {lastCodingTaskResult?.markdownFilename && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                className="btn-secondary"
                type="button"
                disabled={loading}
                onClick={() => {
                  loadRoomFilePreview('tasks', lastCodingTaskResult.markdownFilename);
                  setActiveTab('Tasks');
                }}
                style={{ height: '36px', justifyContent: 'center' }}
              >
                Open Transcript
              </button>
              {lastCodingTaskResult.artifactFilename && (
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    loadRoomFilePreview('documents', lastCodingTaskResult.artifactFilename);
                    setActiveTab('Documents');
                  }}
                  style={{ height: '36px', justifyContent: 'center' }}
                >
                  Open Artifact
                </button>
              )}
            </div>
          )}
        </div>
      );

      const tracePanel = (
        <div className="markdown-preview" style={{ maxHeight: 'none', minHeight: '420px', display: 'grid', gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(280px, 1.2fr)', gap: '14px', alignItems: 'start', overflow: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Context</div>
              <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{selectedCodingTaskContextRefs.length} selected</div>
            </div>
            <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Messages</div>
              <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{codingTaskMessages.length}</div>
            </div>
            <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Output</div>
              <div style={{ marginTop: '4px', color: 'white', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lastCodingTaskResult?.artifactFilename || lastCodingTaskResult?.markdownFilename || 'Pending'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', color: 'hsl(var(--text-secondary))', lineHeight: 1.5, fontSize: '0.86rem' }}>
            <div style={{ color: 'white', fontWeight: 700 }}>Current Run Evidence</div>
            <div>
              This panel is scoped to the active run. It surfaces the selected context, run transcript, and final artifact links that the engine already records.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {selectedCodingTaskContextRefs.map(ref => (
                <div key={ref} style={{ display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '999px', background: 'hsl(var(--accent-purple))', flex: '0 0 auto' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ref}</span>
                </div>
              ))}
              {selectedCodingTaskContextRefs.length === 0 && (
                <div style={{ color: 'hsl(var(--text-muted))' }}>No explicit context selected.</div>
              )}
            </div>
          </div>
        </div>
      );

      return (
        <div style={{ height: '100%', minHeight: '620px', overflow: 'hidden' }}>
          <section style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 360px' }}>
                <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
                  Task Run
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', minWidth: 0, flexWrap: 'wrap' }}>
                  <span className="project-badge" style={{ borderColor: runStatusColor, color: runStatusColor }}>
                    {runStatusText}
                  </span>
                  <span style={{ fontSize: '0.82rem', color: 'white', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'min(520px, 70vw)' }}>
                    {currentRunTitle}
                  </span>
                  <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))' }}>
                    {selectedTaskTypeLabel} · {selectedDoer?.name || 'No doer'} · {codingTaskMessages.length} msgs · {codingTaskReviewerNames.length} reviewers
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {savedTaskRuns.length > 0 && (
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={loading}
                    onClick={() => setActiveTab('Tasks')}
                    style={{ height: '34px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flex: '0 0 auto' }}
                  >
                    Task Archive
                  </button>
                )}
                {lastCodingTaskResult?.markdownFilename && (
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      loadRoomFilePreview('tasks', lastCodingTaskResult.markdownFilename);
                      setActiveTab('Tasks');
                    }}
                    style={{ height: '34px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flex: '0 0 auto' }}
                  >
                    Transcript
                  </button>
                )}
                <button
                  className="btn-primary"
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTaskRunView('setup');
                    setCodingTaskMessages([]);
                    setLastCodingTaskResult(null);
                    setOpenRounds({});
                  }}
                  style={{ height: '34px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flex: '0 0 auto' }}
                >
                  New Run
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid hsl(var(--border-dim))', flex: '0 0 auto' }}>
              {taskRunTabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTaskRunView(tab.id)}
                  style={{
                    height: '36px',
                    padding: '0 12px',
                    border: 0,
                    borderBottom: taskRunView === tab.id ? '2px solid hsl(var(--accent-purple))' : '2px solid transparent',
                    background: 'transparent',
                    color: taskRunView === tab.id ? 'white' : 'hsl(var(--text-muted))',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    cursor: 'pointer'
                  }}
                >
                  {tab.label}{tab.count ? ` ${tab.count}` : ''}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: taskRunView === 'timeline' ? 'hidden' : 'auto' }}>
              {taskRunView === 'setup' && setupPanel}
              {taskRunView === 'timeline' && timelinePanel}
              {taskRunView === 'artifact' && artifactPanel}
              {taskRunView === 'trace' && tracePanel}
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === 'AI Members' || activeTab === 'Agents') {
      const agents = projectData?.agents || [];
      
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' }}>
          {/* Dashboard Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'white' }}>AI Members</h3>
              <p style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0' }}>
                Create role-based personas from templates or custom instructions. Saved AI members live in <code>.room/members/</code>.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setAiMemberDetailsExpanded(current => {
                    localStorage.setItem('room_ai_member_details_expanded', String(!current));
                    return !current;
                  });
                }}
                style={{ padding: '10px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={aiMemberDetailsExpanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                </svg>
                {aiMemberDetailsExpanded ? 'Compact Members' : 'Expand Members'}
              </button>
              <button
                onClick={() => {
                  resetAgentForm();
                  setActiveTab('Agent:New');
                }}
                className="btn-primary"
                style={{ padding: '10px 20px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Register AI Member
              </button>
            </div>
          </div>

          <div style={{
            background: 'hsl(var(--bg-card))',
            border: '1px solid hsl(var(--border-dim))',
            borderRadius: '8px',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <h4 style={{ fontSize: '0.95rem', margin: 0, color: 'white' }}>Recommended Teams</h4>
                <p style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0' }}>
                  Add a starter team for a common workflow. Existing members are skipped.
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
              {teamPresets.map(team => {
                const missingRoles = team.roles.filter(role => !agents.some((agent: any) => String(agent.name).toLowerCase() === role.toLowerCase()));
                const allAdded = missingRoles.length === 0;
                return (
                  <div
                    key={team.name}
                    style={{
                      background: 'hsl(var(--bg-input))',
                      border: '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      minHeight: '156px'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.86rem', color: 'white', fontWeight: 600 }}>{team.name}</div>
                      <div style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5, marginTop: '3px' }}>
                        {team.description}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1, alignContent: 'flex-start' }}>
                      {team.roles.map(role => {
                        const exists = agents.some((agent: any) => String(agent.name).toLowerCase() === role.toLowerCase());
                        return (
                          <span
                            key={role}
                            style={{
                              background: exists ? 'hsl(var(--bg-card))' : 'hsl(var(--accent-purple) / 0.12)',
                              border: exists ? '1px solid hsl(var(--border-dim))' : '1px solid hsl(var(--accent-purple) / 0.35)',
                              color: exists ? 'hsl(var(--text-muted))' : 'hsl(var(--text-secondary))',
                              fontSize: '0.7rem',
                              padding: '4px 8px',
                              borderRadius: '14px'
                            }}
                          >
                            {role}{exists ? ' · added' : ''}
                          </span>
                        );
                      })}
                    </div>
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={() => handleAddTeamPreset(team.name)}
                      disabled={loading || allAdded}
                      style={{ height: '34px', padding: '0 14px', fontSize: '0.8rem', alignSelf: 'flex-start' }}
                    >
                      {allAdded ? 'Added' : 'Add Team'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Registered Agents Grid */}
          {agents.length === 0 ? (
            <div style={{ padding: '60px 40px', textAlign: 'center', color: 'hsl(var(--text-muted))', border: '1px dashed hsl(var(--border-dim))', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ color: 'hsl(var(--text-muted))' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>No AI members registered in this workspace. Add a recommended team or register one manually.</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: aiMemberDetailsExpanded ? 'repeat(auto-fill, minmax(320px, 1fr))' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: aiMemberDetailsExpanded ? '20px' : '10px' }}>
              {agents.map((agent: any, idx: number) => {
                const providerClass = normalizeProviderId(agent.provider).toLowerCase();
                return (
                  <div key={idx} style={{
                    background: 'hsl(var(--bg-card))',
                    border: '1px solid hsl(var(--border-dim))',
                    borderLeft: `4px solid ${
                      providerClass === 'claude' ? 'hsl(var(--accent-purple))' :
                      providerClass === 'gemini' ? 'hsl(var(--accent-blue))' :
                      providerClass === 'codex' ? 'hsl(var(--accent-orange))' : 'hsl(var(--accent-green))'
                    }`,
                    borderRadius: '12px',
                    padding: aiMemberDetailsExpanded ? '16px 20px' : '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: aiMemberDetailsExpanded ? '12px' : '8px',
                    position: 'relative'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'white' }}>{agent.name}</h4>
                        <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 500, marginTop: '2px' }}>{agent.role}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* Edit Button */}
                        <button 
                          className="agent-action-btn"
                          onClick={() => startEditAgent(agent)}
                          title="Edit Agent Config"
                        >
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {/* Delete Button */}
                        <button 
                          className="agent-action-btn delete"
                          onClick={() => handleDeleteAgent(agent.name)}
                          title="Delete Agent"
                        >
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{
                        backgroundColor: 
                          providerClass === 'claude' ? 'rgba(139, 92, 246, 0.1)' : 
                          providerClass === 'gemini' ? 'rgba(59, 130, 246, 0.1)' : 
                          providerClass === 'codex' ? 'rgba(249, 115, 22, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                        color: 
                          providerClass === 'claude' ? 'hsl(var(--accent-purple))' : 
                          providerClass === 'gemini' ? 'hsl(var(--accent-blue))' : 
                          providerClass === 'codex' ? 'hsl(var(--accent-orange))' : 'hsl(var(--accent-green))',
                        fontSize: '0.7rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        textTransform: 'uppercase'
                      }}>
                        {providerLabel(providers, agent.provider)}
                      </span>
                      {agent.provider !== 'Local CLI' && agent.modelName && (
                        <span style={{
                          fontSize: '0.7rem',
                          color: 'hsl(var(--text-secondary))',
                          backgroundColor: 'hsl(var(--bg-input))',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid hsl(var(--border-dim))'
                        }}>
                          {agent.modelName}
                        </span>
                      )}
                      {agent.provider === 'Local CLI' && (
                        <>
                          <span style={{
                            fontSize: '0.7rem',
                            color: 'hsl(var(--text-muted))',
                            backgroundColor: 'hsl(var(--bg-input))',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid hsl(var(--border-dim))',
                            fontFamily: 'monospace'
                          }}>
                            {agent.cliPreset && agent.cliPreset !== 'none' ? `Preset: ${agent.cliPreset === 'claude' ? 'Claude Code' : agent.cliPreset === 'gemini' ? 'Gemini CLI' : agent.cliPreset === 'codex' ? 'Codex CLI' : agent.cliPreset === 'copilot' ? 'GitHub Copilot CLI' : agent.cliPreset === 'codewhale' ? 'CodeWhale' : agent.cliPreset === 'agy' ? 'Antigravity CLI' : agent.cliPreset}` : `$ ${agent.command}`}
                          </span>
                          <span style={{
                            fontSize: '0.7rem',
                            color: 'hsl(var(--text-secondary))',
                            backgroundColor: 'hsl(var(--bg-input))',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid hsl(var(--border-dim))'
                          }}>
                            {agent.modelName ? `Model: ${agent.modelName}` : 'Model: Default CLI config'}
                          </span>
                            {agent.permissionMode === 'dangerous' && (
                              <span style={{
                                fontSize: '0.7rem',
                                color: '#ef4444',
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                fontFamily: 'monospace'
                              }}>
                                dangerous permissions enabled
                              </span>
                            )}
                        </>
                      )}
                    </div>

                    {aiMemberDetailsExpanded && (
                      <div style={{
                        fontSize: '0.8rem',
                        color: 'hsl(var(--text-secondary))',
                        lineHeight: '1.5',
                        background: 'hsl(var(--bg-input))',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        border: '1px solid hsl(var(--border-dim))',
                        maxHeight: '60px',
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap'
                      }}>
                        {agent.systemPrompt}
                      </div>
                    )}

                    {aiMemberDetailsExpanded && agent.skills && agent.skills.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto', paddingTop: '8px' }}>
                        {agent.skills.map((skill: string) => (
                          <span key={skill} style={{
                            backgroundColor: 'hsl(var(--bg-input))',
                            color: 'hsl(var(--text-muted))',
                            fontSize: '0.65rem',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid hsl(var(--border-dim))',
                            fontWeight: 500
                          }}>
                            {skill.replace('.md', '').replace(/-/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Collapsible Local CLI ToolchainAccordion */}
          <details className="collapsible-container">
            <summary className="collapsible-summary">
              <span>🔍 Local CLI Toolchain Status ({detectedClis.filter(c => c.available).length} Detected)</span>
            </summary>
            <div className="collapsible-content">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                  Scanning your system PATH and toolchains for compatible local CLI agents.
                </span>
                <button 
                  onClick={async () => {
                    setLoading(true);
                    try {
                      const res = await window.electronAPI.detectLocalAgents();
                      if (res.success && res.agents) {
                        setDetectedClis(res.agents);
                      }
                    } catch (err) {
                      console.error(err);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                >
                  ↻ Rescan Toolchain
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                {detectedClis.map((cli) => (
                  <div key={cli.id} style={{
                    background: 'hsl(var(--bg-card))',
                    border: '1px solid hsl(var(--border-dim))',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: cli.available ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: cli.available ? '#10b981' : 'hsl(var(--text-muted))',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      flexShrink: 0
                    }}>
                      {cli.name.substring(0, 1)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: cli.available ? 'white' : 'hsl(var(--text-secondary))' }}>{cli.name}</span>
                        <span style={{
                          fontSize: '0.65rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          backgroundColor: cli.available ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: cli.available ? '#10b981' : '#ef4444'
                        }}>
                          {cli.available ? 'Installed' : 'Not Found'}
                        </span>
                      </div>
                      <div style={{
                        fontSize: '0.75rem',
                        color: 'hsl(var(--text-muted))',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginTop: '2px'
                      }} title={cli.path || undefined}>
                        {cli.available ? (cli.version || 'On PATH') : 'Not on PATH'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>

        </div>
      );
    }

    if (activeTab.startsWith('Agent:')) {
      const isNew = activeTab === 'Agent:New';
      const availableSkills = projectData?.skills || [];
      const modelOptions = getModelOptions(newAgentProvider, newAgentPreset);
      const isCustomModel = newAgentModel && !modelOptions.some(opt => opt.value === newAgentModel);
      const isLocalCliAgent = newAgentProvider === 'Local CLI';
      const shouldShowModel = isLocalCliAgent || modelOptions.length > 0 || newAgentProvider !== 'Local CLI';

      return (
        <div className="focus-editor-container">
          <div className="focus-editor-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span 
                  onClick={() => { resetAgentForm(); setActiveTab('AI Members'); }} 
                  style={{ color: 'hsl(var(--accent-purple))', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to AI Members
                </span>
              </div>
              <h2 className="focus-editor-title">
                {isNew ? 'Register New AI Agent' : `Edit Agent: ${editingAgent?.name || newAgentName}`}
              </h2>
            </div>
            {!isNew && (
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => handleDeleteAgent(editingAgent?.name || newAgentName)}
                style={{ borderColor: '#ef4444', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 16px' }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Agent
              </button>
            )}
          </div>

          <form onSubmit={handleSaveAgent} className="focus-editor-card">
            {errorMsg && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '12px 16px', borderRadius: '8px', color: '#ef4444', fontSize: '0.85rem', marginBottom: '16px' }}>
                {errorMsg}
              </div>
            )}

            {isNew && (
              <div style={{
                background: 'hsl(var(--bg-input))',
                border: '1px dashed hsl(var(--border-dim))',
                borderRadius: '8px',
                padding: '16px 20px',
                marginBottom: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ⚡ Quick Load Template
                </span>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {agentPersonaTemplates.map(tmpl => (
                    <button
                      key={tmpl.name}
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '6px 14px', height: 'auto', borderRadius: '6px' }}
                      onClick={async () => {
                        setNewAgentName(tmpl.name);
                        setNewAgentRole(tmpl.role);
                        setNewAgentPrompt(tmpl.prompt);
                        setErrorMsg(null);

                        try {
                          const skillFiles = await ensureTemplateSkills(tmpl.skills);
                          setNewAgentSkills(skillFiles);
                          if (projectPath) {
                            await loadProjectData(projectPath);
                          }
                        } catch (err: any) {
                          setErrorMsg(err.message || 'Failed to create template skills.');
                        }
                      }}
                    >
                      {tmpl.name}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                  Clicking a template fills role, persona, and recommended skills. Choose the provider and model separately.
                </span>
              </div>
            )}

            {/* 2-Column Section */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', alignItems: 'start' }}>
              {/* Left Column: Config */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Agent Name</label>
                  <input 
                    type="text"
                    required
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    placeholder="e.g., AppSec Auditor"
                    style={{
                      backgroundColor: 'hsl(var(--bg-input))',
                      border: '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'white',
                      fontFamily: 'inherit',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Role</label>
                  <input 
                    type="text"
                    required
                    value={newAgentRole}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    placeholder="e.g., Security Specialist"
                    style={{
                      backgroundColor: 'hsl(var(--bg-input))',
                      border: '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'white',
                      fontFamily: 'inherit',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Provider (AI Agent/Model Type)</label>
                  <select 
                    value={
                      newAgentProvider === 'Local CLI' 
                        ? `Local CLI:${newAgentPreset}` 
                        : newAgentProvider
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith('Local CLI:')) {
                        const presetKey = val.replace('Local CLI:', '');
                        setNewAgentProvider('Local CLI');
                        setNewAgentPreset(presetKey as any);
                        setNewAgentPermissionMode('safe');
                        setNewAgentModelCustom(false);
                        setNewAgentModel('');
                        setSkillPreview(null);
                      } else {
                        setNewAgentProvider(val as any);
                        setNewAgentPreset('none');
                        setNewAgentPermissionMode('safe');
                        const defaults = getModelOptions(val);
                        setNewAgentModelCustom(false);
                        setNewAgentModel(defaults[0]?.value || '');
                        setSkillPreview(null);
                      }
                    }}
                    style={{
                      backgroundColor: 'hsl(var(--bg-input))',
                      border: '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'white',
                      fontFamily: 'inherit',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  >
                    <optgroup label="API Providers">
                      {providers.map(provider => (
                        <option key={provider.id} value={provider.id}>{provider.label}</option>
                      ))}
                    </optgroup>
                    
                    <optgroup label="Detected Local CLI Agents">
                      {detectedClis.filter(c => c.available).map(cli => (
                        <option key={cli.id} value={`Local CLI:${cli.id}`}>
                          Local CLI: {cli.name} (Installed)
                        </option>
                      ))}
                    </optgroup>
                    
                    <optgroup label="Other Local CLI Presets">
                      {detectedClis.filter(c => !c.available).map(cli => (
                        <option key={cli.id} value={`Local CLI:${cli.id}`}>
                          Local CLI: {cli.name} (Not Installed)
                        </option>
                      ))}
                      <option value="Local CLI:none">Local CLI: Custom Command...</option>
                    </optgroup>
                  </select>
                </div>

                {shouldShowModel && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Model Name</label>
                    <select 
                      value={newAgentModelCustom || isCustomModel ? 'custom' : newAgentModel || (isLocalCliAgent ? '' : modelOptions[0]?.value || '')}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'custom') {
                          setNewAgentModelCustom(true);
                          setNewAgentModel('');
                        } else {
                          setNewAgentModelCustom(false);
                          setNewAgentModel(val);
                        }
                      }}
                      style={{
                        backgroundColor: 'hsl(var(--bg-input))',
                        border: '1px solid hsl(var(--border-dim))',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        color: 'white',
                        fontFamily: 'inherit',
                        fontSize: '0.9rem',
                        outline: 'none'
                      }}
                    >
                      {isLocalCliAgent && (
                        <option value="">Default CLI Model</option>
                      )}
                      {modelOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                      <option value="custom">Custom Model...</option>
                    </select>
                    {isLocalCliAgent && (
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                        Leave this on Default CLI Model to let the selected local CLI use its own configured default.
                      </span>
                    )}
                    
                    {(newAgentModelCustom || isCustomModel || (!isLocalCliAgent && (!newAgentModel || modelOptions.length === 0))) && (
                      <input 
                        type="text"
                        required={!isLocalCliAgent}
                        value={newAgentModel}
                        onChange={(e) => setNewAgentModel(e.target.value)}
                        placeholder="Enter model identifier (e.g., deepseek-coder)"
                        style={{
                          backgroundColor: 'hsl(var(--bg-input))',
                          border: '1px solid hsl(var(--border-dim))',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          color: 'white',
                          fontFamily: 'inherit',
                          fontSize: '0.9rem',
                          outline: 'none',
                          marginTop: '6px'
                        }}
                      />
                    )}
                  </div>
                )}

                {newAgentProvider === 'Local CLI' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px', borderLeft: '2px solid hsl(var(--border-dim))', paddingLeft: '12px' }}>
                    {newAgentPreset === 'none' ? (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>CLI Command</label>
                          <input 
                            type="text"
                            required
                            value={newAgentCommand}
                            onChange={(e) => setNewAgentCommand(e.target.value)}
                            placeholder="e.g., node agent.js or python3 script.py"
                            style={{
                              backgroundColor: 'hsl(var(--bg-input))',
                              border: '1px solid hsl(var(--border-dim))',
                              borderRadius: '8px',
                              padding: '10px 12px',
                              color: 'white',
                              fontFamily: 'inherit',
                              fontSize: '0.9rem',
                              outline: 'none'
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Stdin Format</label>
                          <select 
                            value={newAgentStdinFormat}
                            onChange={(e) => {
                              setNewAgentStdinFormat(e.target.value as any);
                              setSkillPreview(null);
                            }}
                            style={{
                              backgroundColor: 'hsl(var(--bg-input))',
                              border: '1px solid hsl(var(--border-dim))',
                              borderRadius: '8px',
                              padding: '10px 12px',
                              color: 'white',
                              fontFamily: 'inherit',
                              fontSize: '0.9rem',
                              outline: 'none'
                            }}
                          >
                            <option value="text">Plain text prompt</option>
                            <option value="json">JSON payload {"{ prompt, systemInstruction }"}</option>
                          </select>
                        </div>
                      </>
                    ) : (
                      <div style={{
                        fontSize: '0.75rem',
                        border: '1px solid hsl(var(--border-dim))',
                        color: 'hsl(var(--text-secondary))',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        padding: '12px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: '8px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600 }}>Preset Status:</span>
                          {(() => {
                            const cli = detectedClis.find(c => c.id === newAgentPreset);
                            if (cli?.available) {
                              return <span style={{ color: '#10b981', fontWeight: 600 }}>✓ Installed</span>;
                            }
                            return <span style={{ color: '#ef4444', fontWeight: 600 }}>⚠ Not on PATH</span>;
                          })()}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
                          {newAgentPreset === 'claude' && "Safe mode by default; dangerous mode must be explicitly enabled."}
                          {newAgentPreset === 'gemini' && "Safe mode by default; workspace trust and yolo execution are disabled until dangerous mode."}
                          {newAgentPreset === 'codex' && "Safe sandboxed mode by default; network access override is disabled until dangerous mode."}
                          {newAgentPreset === 'copilot' && "Safe mode by default; auto-approve tooling requires dangerous mode."}
                          {newAgentPreset === 'codewhale' && "Safe mode by default; auto-exec and prompt mode disabled until dangerous mode."}
                          {newAgentPreset === 'agy' && "Safe mode by default; skip-permissions behavior disabled until dangerous mode."}
                        </div>
                        <label style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '0.75rem',
                          color: 'hsl(var(--text-secondary))'
                        }}>
                          <input
                            type="checkbox"
                            checked={newAgentPermissionMode === 'dangerous'}
                            onChange={(e) => setNewAgentPermissionMode(e.target.checked ? 'dangerous' : 'safe')}
                          />
                          <span>
                            <span style={{ fontWeight: 600 }}>Enable dangerous permissions</span>
                            <span style={{ color: 'hsl(var(--text-muted))' }}> (requires explicit opt-in; grants filesystem/network and tool privileges)</span>
                          </span>
                        </label>
                        {newAgentPermissionMode === 'dangerous' && (
                          <div style={{ fontSize: '0.7rem', color: '#ef4444', lineHeight: '1.4' }}>
                            Warning: dangerous mode may allow destructive actions in your workspace.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Skills */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Assign Skills</label>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={loading || newAgentSkills.length === 0}
                    onClick={handlePreviewAgentSkills}
                    style={{ fontSize: '0.72rem', padding: '6px 10px', height: 'auto' }}
                  >
                    Check Skills
                  </button>
                </div>
                {availableSkills.length === 0 ? (
                  <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>No skills found. Create a custom skill below or save an agent without skills.</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
                    {availableSkills.map((skill) => {
                      const isSelected = newAgentSkills.includes(skill);
                      return (
                        <div
                          key={skill}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                            gap: '8px',
                            alignItems: 'center',
                            background: editingSkillFile === skill ? 'hsl(var(--accent-purple) / 0.12)' : 'hsl(var(--bg-input))',
                            border: editingSkillFile === skill ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                            borderRadius: '8px',
                            padding: '8px 10px'
                          }}
                        >
                          <label
                            className={`skill-checkbox-chip ${isSelected ? 'selected' : ''}`}
                            style={{ minWidth: 0, width: '100%', justifyContent: 'flex-start' }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSkillPreview(null);
                                setNewAgentSkills(prev =>
                                  prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
                                );
                              }}
                            />
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {isSelected ? '✓ ' : '+ '}
                              {skill.replace('.md', '').replace(/-/g, ' ')}
                            </span>
                          </label>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={loading}
                            onClick={() => loadRoomFilePreview('skills', skill)}
                            style={{ fontSize: '0.72rem', padding: '5px 9px', height: 'auto' }}
                          >
                            Edit
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {skillPreview && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    background: skillPreview.readableCount === skillPreview.totalCount ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                    border: skillPreview.readableCount === skillPreview.totalCount ? '1px solid rgba(16, 185, 129, 0.28)' : '1px solid rgba(239, 68, 68, 0.28)',
                    borderRadius: '8px',
                    padding: '10px 12px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-secondary))' }}>
                        {skillPreview.readableCount}/{skillPreview.totalCount} skills readable
                      </span>
                      <span style={{ fontSize: '0.7rem', color: skillPreview.readableCount === skillPreview.totalCount ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                        {skillPreview.readableCount === skillPreview.totalCount ? 'READY' : 'CHECK NEEDED'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', lineHeight: 1.45 }}>
                      {skillPreview.delivery}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {skillPreview.items.map(item => (
                        <div
                          key={item.filename}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '18px minmax(0, 1fr)',
                            gap: '8px',
                            alignItems: 'start',
                            fontSize: '0.72rem',
                            color: item.readable ? 'hsl(var(--text-secondary))' : '#ef4444'
                          }}
                        >
                          <span>{item.readable ? '✓' : '!'}</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.filename}{item.source ? ` · .room/${item.source}` : ''}
                            </span>
                            <span style={{ display: 'block', color: 'hsl(var(--text-muted))', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.readable ? `${item.heading || 'No heading'} · ${formatFileSize(item.bytes || 0)}` : item.error}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {editingSkillFile && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    background: 'hsl(var(--bg-input))',
                    border: '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '12px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                          Edit Skill
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {editingSkillFile}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={loading}
                        onClick={() => {
                          setEditingSkillFile('');
                          setEditingSkillContent('');
                          setEditingSkillSource('skills');
                        }}
                        style={{ fontSize: '0.72rem', padding: '5px 9px', height: 'auto' }}
                      >
                        Close
                      </button>
                    </div>
                    <textarea
                      value={editingSkillContent}
                      onChange={(e) => setEditingSkillContent(e.target.value)}
                      rows={10}
                      disabled={loading}
                      style={{
                        width: '100%',
                        resize: 'vertical',
                        minHeight: '180px',
                        backgroundColor: 'hsl(var(--bg-card))',
                        border: '1px solid hsl(var(--border-dim))',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        color: 'white',
                        fontFamily: 'monospace',
                        fontSize: '0.78rem',
                        lineHeight: 1.5,
                        outline: 'none'
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
                        {editingSkillSource === 'roles'
                          ? 'Loaded from legacy .room/roles. Saving migrates this skill to .room/skills.'
                          : 'Saved edits are written to .room/skills and can be assigned immediately.'}
                      </span>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={loading}
                        onClick={handleSaveEditingSkill}
                        style={{ fontSize: '0.78rem', padding: '8px 12px', whiteSpace: 'nowrap' }}
                      >
                        Save Skill
                      </button>
                    </div>
                  </div>
                )}

                {/* Custom Skill Creator */}
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px', 
                  marginTop: '12px', 
                  paddingTop: '12px', 
                  borderTop: '1px dashed hsl(var(--border-dim))' 
                }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>Create Custom Skill</span>
                  <input 
                    type="text"
                    placeholder="Role or Skill Name (e.g. Story Continuity)"
                    value={customSkillName}
                    onChange={(e) => setCustomSkillName(e.target.value)}
                    className="custom-skill-input"
                    style={{ width: '100%' }}
                  />
                  <textarea 
                    rows={3}
                    placeholder="Skill Description / Instructions (e.g. Keep dialogue natural, check continuity, or verify assumptions...)"
                    value={customSkillDesc}
                    onChange={(e) => setCustomSkillDesc(e.target.value)}
                    className="custom-skill-input"
                    style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.8rem' }}
                  />
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    style={{ fontSize: '0.8rem', padding: '8px 12px', alignSelf: 'flex-end' }}
                    onClick={handleAddCustomSkill}
                  >
                    + Save Skill
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Row: System Prompt */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>System Prompt & Persona Instructions</label>
              <textarea 
                required
                rows={12}
                value={newAgentPrompt}
                onChange={(e) => setNewAgentPrompt(e.target.value)}
                placeholder="Describe this agent's persona, responsibility, constraints, and output format. This is sent directly to the model."
                style={{
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  color: 'white',
                  fontFamily: 'inherit',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'vertical',
                  lineHeight: '1.5',
                  minHeight: '200px'
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                Sent to the model as the primary persona contract, then ROOM appends selected skills, discussion protocol, and workspace context.
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid hsl(var(--border-dim))', paddingTop: '20px' }}>
              <button type="button" className="btn-secondary" onClick={() => { resetAgentForm(); setActiveTab('AI Members'); }} style={{ height: '38px', padding: '0 20px' }}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={loading} style={{ height: '38px', padding: '0 28px', fontSize: '0.85rem', fontWeight: 600 }}>
                {loading ? 'Saving...' : isNew ? 'Register AI Member' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      );
    }

    if (activeTab === 'Context' || activeTab === 'Architecture') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minHeight: '560px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
              Workspace context and structure stored under <code>.room/context/</code>. These are included by the Discuss Context Picker.
            </div>
            <button className="btn-primary" type="button" onClick={saveContextDrafts} disabled={loading} style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}>
              {loading ? 'Saving...' : 'Save Context'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', minHeight: 0 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                Overview
              </span>
              <textarea
                value={contextOverviewDraft}
                onChange={(e) => setContextOverviewDraft(e.target.value)}
                disabled={loading}
                placeholder="Describe the project, goals, source material, constraints, and open questions..."
                style={{
                  height: '520px',
                  resize: 'vertical',
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  color: 'white',
                  fontFamily: 'inherit',
                  lineHeight: 1.6,
                  outline: 'none'
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                Structure
              </span>
              <textarea
                value={contextStructureDraft}
                onChange={(e) => setContextStructureDraft(e.target.value)}
                disabled={loading}
                placeholder="Describe key areas, documents, characters, systems, constraints, or how this workspace is organized..."
                style={{
                  height: '520px',
                  resize: 'vertical',
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  color: 'white',
                  fontFamily: 'inherit',
                  lineHeight: 1.6,
                  outline: 'none'
                }}
              />
            </label>
          </div>
        </div>
      );
    }

    if (activeTab === 'Decisions') {
      const decisions = projectData?.decisions || [];
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', minHeight: '520px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
            Legacy decision records from <code>.room/decisions/</code>.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {decisions.length === 0 ? (
              <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No decision records found.</div>
            ) : (
              decisions.map((dec) => {
                const selected = selectedDecisionFile === dec;
                return (
                <button key={dec} type="button" onClick={() => loadRoomFilePreview('decisions', dec)} style={{
                  background: 'hsl(var(--bg-card))',
                  border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '16px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: 'inherit',
                  textAlign: 'left',
                  font: 'inherit'
                }}>
                  <span style={{ fontWeight: 500 }}>{dec}</span>
                  <span style={{ color: 'hsl(var(--accent-purple))', fontSize: '0.8rem', fontWeight: 600 }}>Preview ADR</span>
                </button>
              );
              })
            )}
          </div>
          </div>
          <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
            {renderMarkdownContent(selectedDecisionContent || (decisions.length > 0 ? '# Select an ADR to preview.' : '# No decision records found.'), false, 'message-markdown')}
          </div>
        </div>
      );
    }

    if (activeTab === 'Tasks') {
      const tasks = projectData?.tasks || [];
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', minHeight: '520px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {taskBoardCards.length > 0 && (
              <div style={{ background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '14px 16px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
                  Task Board
                </div>
                {(() => {
                  const knownIds = new Set(taskBoardCards.map(card => card.id));
                  const childrenOf = new Map<string, TaskBoardCard[]>();
                  const roots: TaskBoardCard[] = [];
                  for (const card of taskBoardCards) {
                    if (card.parentId && knownIds.has(card.parentId)) {
                      const list = childrenOf.get(card.parentId) || [];
                      list.push(card);
                      childrenOf.set(card.parentId, list);
                    } else {
                      roots.push(card);
                    }
                  }
                  const renderCard = (card: TaskBoardCard, depth: number): JSX.Element => (
                    <div key={card.id} style={{ marginLeft: depth > 0 ? '14px' : '0px', fontSize: '0.82rem', padding: '2px 0' }}>
                      <span style={{ color: 'hsl(var(--text-muted))' }}>{card.status === 'done' ? '☑' : '☐'} </span>
                      <span style={{ color: 'hsl(var(--accent-purple))', fontWeight: 600 }}>{card.id}</span>
                      <span style={{ color: 'hsl(var(--text-muted))' }}> ({card.kind}) </span>
                      {card.title}
                      {childrenOf.get(card.id)?.map(child => renderCard(child, depth + 1))}
                    </div>
                  );
                  return roots.map(card => renderCard(card, 0));
                })()}
              </div>
            )}
            <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
              Workspace task notes logged under <code>.room/tasks/</code>, with created task cards linked back to their source discussion when available.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {tasks.length === 0 ? (
                <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No task files found.</div>
              ) : (
                tasks.map((task) => {
                  const selected = selectedTaskFile === task;
                  return (
                    <button key={task} type="button" onClick={() => loadRoomFilePreview('tasks', task)} style={{
                      background: 'hsl(var(--bg-card))',
                      border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '14px 16px',
                      cursor: 'pointer',
                      color: 'inherit',
                      textAlign: 'left',
                      font: 'inherit'
                    }}>
                      {task}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
            {renderMarkdownContent(selectedTaskContent || (tasks.length > 0 ? '# Select a task file to preview.' : '# No task files found.'), false, 'message-markdown')}
          </div>
        </div>
      );
    }

    if (activeTab === 'Documents' || activeTab === 'Reviews') {
      const documentFiles = projectData?.documents || [];
      const reviewFiles = projectData?.reviews || [];
      const discussionFiles = (projectData?.discussions || []).filter(file => file.toLowerCase().endsWith('.md'));
      const items = documentFiles.length > 0
        ? documentFiles.map(file => ({ section: 'documents' as const, file }))
        : reviewFiles.length > 0
        ? reviewFiles.map(file => ({ section: 'reviews' as const, file }))
        : discussionFiles.map(file => ({ section: 'discussions' as const, file }));

      return (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', minHeight: '520px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
              Documents from <code>.room/documents/</code>. If empty, markdown discussion transcripts from <code>.room/discussions/</code> are shown, including stable message IDs and references.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {items.length === 0 ? (
                <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No review or discussion logs found.</div>
              ) : (
                items.map(({ section, file }) => {
                  const selected = selectedReviewFile === file && selectedReviewSection === section;
                  return (
                    <button key={`${section}:${file}`} type="button" onClick={() => loadRoomFilePreview(section, file)} style={{
                      background: 'hsl(var(--bg-card))',
                      border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '14px 16px',
                      cursor: 'pointer',
                      color: 'inherit',
                      textAlign: 'left',
                      font: 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      <span>{file}</span>
                      <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.75rem' }}>{section}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
            {renderMarkdownContent(selectedReviewContent || (items.length > 0 ? '# Select a review or discussion log to preview.' : '# No review logs found.'), false, 'message-markdown')}
          </div>
        </div>
      );
    }

    if (activeTab === 'Files') {
      const query = workspaceFileSearch.trim().toLowerCase();
      const visibleFiles = query
        ? workspaceFiles.filter(file => file.path.toLowerCase().includes(query))
        : workspaceFiles;
      const visibleFolderCount = visibleFiles.filter(file => file.kind === 'directory').length;
      const visibleFileCount = visibleFiles.length - visibleFolderCount;

      return (
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '24px', minHeight: '560px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="search"
                value={workspaceFileSearch}
                onChange={(e) => setWorkspaceFileSearch(e.target.value)}
                placeholder="Search workspace files and folders..."
                style={{
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: 'white',
                  fontFamily: 'inherit',
                  outline: 'none'
                }}
              />
              <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.78rem' }}>
                {visibleFolderCount} folders, {visibleFileCount} files{workspaceFilesTruncated ? ' shown. Large workspaces are limited to the first 500 items.' : ''}
              </div>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxHeight: '520px',
              overflowY: 'auto',
              paddingRight: '4px'
            }}>
              {visibleFiles.length === 0 ? (
                <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No workspace files or folders found.</div>
              ) : (
                visibleFiles.map((file) => {
                  const selected = selectedWorkspaceFile === file.path;
                  const isDirectory = file.kind === 'directory';
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => loadWorkspaceFilePreview(file.path)}
                      style={{
                        background: selected ? 'hsl(var(--accent-purple) / 0.14)' : 'hsl(var(--bg-card))',
                        border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        cursor: 'pointer',
                        color: 'inherit',
                        textAlign: 'left',
                        font: 'inherit',
                        minWidth: 0
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span style={{ color: isDirectory ? 'hsl(var(--accent-blue))' : 'hsl(var(--text-muted))', fontSize: '0.78rem', fontWeight: 750 }}>
                          {isDirectory ? '[dir]' : '[file]'}
                        </span>
                        <span style={{ fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {file.path}
                        </span>
                      </div>
                      <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem', marginTop: '4px' }}>
                        {isDirectory ? 'Folder' : formatFileSize(file.size)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', minHeight: '20px', wordBreak: 'break-all' }}>
              {selectedWorkspaceFile || 'Select a file or folder to preview.'}
            </div>
            <pre className="markdown-preview" style={{
              maxHeight: 'none',
              height: '520px',
              fontSize: '0.86rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0
            }}>
              {selectedWorkspaceFileContent || '# Select a workspace file or folder to preview.'}
            </pre>
          </div>
        </div>
      );
    }

    if (activeTab === 'Overview') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
            Active workspace overview located in <code>.room/context/overview.md</code>.
          </div>
          <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
            {projectData?.projectMd || '# No project details loaded.'}
          </div>
        </div>
      );
    }

    if (activeTab === 'MCP Servers') {
      const serverKeys = Object.keys(mcpConfig.mcpServers || {});
      return (
        <div style={{ display: 'flex', gap: '24px', height: '100%', minHeight: '500px' }}>
          {/* Left panel: list of servers */}
          <div style={{
            width: '260px',
            background: 'hsl(var(--bg-card))',
            border: '1px solid hsl(var(--border-dim))',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px',
              borderBottom: '1px solid hsl(var(--border-dim))',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>MCP Servers</span>
              <button
                className="btn-primary"
                onClick={() => handleSelectMcpServer('New')}
                style={{ padding: '4px 10px', fontSize: '0.75rem', height: 'auto', borderRadius: '4px' }}
              >
                + Add
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {serverKeys.length === 0 ? (
                <div style={{ padding: '20px 10px', textAlign: 'center', color: 'hsl(var(--text-muted))', fontSize: '0.8rem' }}>
                  No servers configured.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {serverKeys.map((key) => {
                    const isSelected = selectedMcpServer === key;
                    return (
                      <div
                        key={key}
                        onClick={() => handleSelectMcpServer(key)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          background: isSelected ? 'hsl(var(--accent-purple-dim))' : 'transparent',
                          border: isSelected ? '1px solid hsl(var(--accent-purple))' : '1px solid transparent',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          transition: 'all 0.15s ease'
                        }}
                        className={isSelected ? '' : 'submenu-item'}
                      >
                        <span style={{ fontSize: '0.85rem', fontWeight: isSelected ? 600 : 500, color: isSelected ? 'hsl(var(--text-primary))' : 'hsl(var(--text-secondary))' }}>
                          {key}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteMcpServer(key);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'hsl(var(--accent-orange))',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: '0.75rem',
                            opacity: isSelected ? 1 : 0.6
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: editing form */}
          <div style={{ flex: 1 }}>
            {selectedMcpServer === null ? (
              <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                border: '1px dashed hsl(var(--border-dim))',
                borderRadius: '8px',
                padding: '40px',
                color: 'hsl(var(--text-muted))',
                textAlign: 'center'
              }}>
                <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginBottom: '16px', opacity: 0.6 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', marginBottom: '8px' }}>No MCP Server Selected</h4>
                <p style={{ fontSize: '0.8rem', maxWidth: '320px' }}>Select an existing server configuration from the list or click "+ Add" to configure a new one.</p>
              </div>
            ) : (
              <form onSubmit={handleSaveMcpServer} className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px', color: 'hsl(var(--accent-purple))' }}>
                  {selectedMcpServer === 'New' ? 'Add New MCP Server' : `Edit Server: ${selectedMcpServer}`}
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Server Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={mcpServerName}
                    onChange={(e) => setMcpServerName(e.target.value)}
                    placeholder="e.g. everything"
                    required
                    style={{ fontSize: '0.85rem' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Only lowercase letters, numbers, hyphens, and underscores.</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Command</label>
                  <input
                    type="text"
                    className="form-input"
                    value={mcpServerCommand}
                    onChange={(e) => setMcpServerCommand(e.target.value)}
                    placeholder="e.g. npx or uvx or node"
                    required
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Arguments (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={mcpServerArgs}
                    onChange={(e) => setMcpServerArgs(e.target.value)}
                    placeholder="e.g. -y @modelcontextprotocol/server-everything"
                    style={{ fontSize: '0.85rem' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                    Supports shell-style quoting, for example <code>--label &quot;My Project&quot;</code>.
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Environment Variables (optional)</label>
                  <textarea
                    className="form-textarea"
                    value={mcpServerEnv}
                    onChange={(e) => setMcpServerEnv(e.target.value)}
                    placeholder="KEY=VALUE&#10;ANOTHER_KEY=ANOTHER_VALUE"
                    style={{ fontSize: '0.85rem', minHeight: '80px', fontFamily: 'monospace' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>One environment variable per line in <code>KEY=VALUE</code> format.</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px', borderTop: '1px solid hsl(var(--border-dim))', paddingTop: '16px' }}>
                  <button type="button" className="btn-secondary" onClick={() => { setSelectedMcpServer(null); resetMcpForm(); }} style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem' }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={loading} style={{ height: '36px', padding: '0 24px', fontSize: '0.8rem', fontWeight: 600 }}>
                    {loading ? 'Saving...' : selectedMcpServer === 'New' ? 'Add Server' : 'Save Config'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'Settings') {
      const detectedClisOptions = detectedClis.filter(c => c.available);
      const modelOptions = projectConfig.mainAgent !== 'none' ? (dynamicCliModels[projectConfig.mainAgent] || getModelOptions('Local CLI', projectConfig.mainAgent)) : [];

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
          {/* Section 0: AI Providers */}
          <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-green))', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H3v-4l6.257-6.257A6 6 0 1121 9z" />
                </svg>
                AI Providers
              </h4>
              <button type="button" className="btn-secondary" onClick={() => setAddProviderOpen(true)} disabled={loading} style={{ height: '32px', padding: '0 14px', fontSize: '0.78rem' }}>
                + Add Provider
              </button>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5 }}>
              Keys are stored locally on this machine, outside <code>.room/</code>. Any OpenAI-compatible endpoint can be added. Leave a key field blank to keep the existing key.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {providers.map(provider => (
                <div key={provider.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid hsl(var(--border-dim))', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>{provider.label}</label>
                      {provider.baseUrl && (
                        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider.baseUrl}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{
                        fontSize: '0.68rem',
                        color: provider.hasKey ? '#10b981' : 'hsl(var(--text-muted))',
                        background: provider.hasKey ? 'rgba(16, 185, 129, 0.1)' : 'hsl(var(--bg-input))',
                        border: provider.hasKey ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid hsl(var(--border-dim))',
                        borderRadius: '10px',
                        padding: '2px 7px',
                        whiteSpace: 'nowrap'
                      }}>
                        {provider.hasKey ? 'Configured' : 'No key'}
                      </span>
                      <button type="button" className="btn-secondary" onClick={() => handleTestProvider(provider.id)} disabled={loading} style={{ height: '28px', padding: '0 10px', fontSize: '0.72rem' }}>
                        Test
                      </button>
                      {!provider.builtIn && (
                        <button type="button" className="btn-secondary" onClick={() => handleDeleteProvider(provider.id)} disabled={loading} style={{ height: '28px', padding: '0 10px', fontSize: '0.72rem' }}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="password"
                      value={providerKeyDrafts[provider.id] || ''}
                      disabled={loading}
                      onChange={(e) => setProviderKeyDrafts(prev => ({ ...prev, [provider.id]: e.target.value }))}
                      placeholder={provider.hasKey ? 'Configured. Enter a new key to replace.' : 'Paste API key (optional for local endpoints)'}
                      style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontFamily: 'inherit', fontSize: '0.84rem', outline: 'none', flex: 1 }}
                    />
                    <button type="button" className="btn-primary" onClick={() => handleSaveProviderKey(provider.id)} disabled={loading || !(providerKeyDrafts[provider.id] || '').trim()} style={{ height: '34px', padding: '0 14px', fontSize: '0.76rem' }}>
                      Save Key
                    </button>
                  </div>
                  {providerTestResults[provider.id] && (
                    <span style={{ fontSize: '0.72rem', color: providerTestResults[provider.id].ok ? '#10b981' : '#f87171' }}>
                      {providerTestResults[provider.id].message}
                    </span>
                  )}
                  {provider.baseUrl?.startsWith('http://') && !provider.baseUrl.includes('localhost') && !provider.baseUrl.includes('127.0.0.1') && (
                    <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>Warning: unencrypted http:// endpoint.</span>
                  )}
                </div>
              ))}
            </div>
            {addProviderOpen && (
              <div style={{ border: '1px solid hsl(var(--border-dim))', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Add Provider</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {PROVIDER_PRESETS.filter(preset => !providers.some(provider => provider.id === preset.id)).map(preset => (
                    <button key={preset.id} type="button" className="btn-secondary" style={{ height: '30px', padding: '0 12px', fontSize: '0.74rem' }}
                      onClick={() => setAddProviderDraft({ id: preset.id, label: preset.label, baseUrl: preset.baseUrl, apiKey: '' })}>
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input type="text" placeholder="id (e.g. groq)" value={addProviderDraft.id} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, id: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none' }} />
                  <input type="text" placeholder="Display name" value={addProviderDraft.label} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, label: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none' }} />
                  <input type="text" placeholder="Base URL (https://.../v1)" value={addProviderDraft.baseUrl} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, baseUrl: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none', gridColumn: '1 / -1' }} />
                  <input type="password" placeholder="API key (optional)" value={addProviderDraft.apiKey} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none', gridColumn: '1 / -1' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button type="button" className="btn-secondary" onClick={() => { setAddProviderOpen(false); setAddProviderDraft({ id: '', label: '', baseUrl: '', apiKey: '' }); }} style={{ height: '34px', padding: '0 14px', fontSize: '0.76rem' }}>
                    Cancel
                  </button>
                  <button type="button" className="btn-primary" onClick={handleAddProvider}
                    disabled={loading || !addProviderDraft.id.trim() || !addProviderDraft.baseUrl.trim()}
                    style={{ height: '34px', padding: '0 16px', fontSize: '0.76rem' }}>
                    Add Provider
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 1: Workspace Agent Settings */}
          <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-purple))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              Workspace Agent & Scanner Defaults
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Scanner Agent</label>
                <select
                  className="form-select"
                  value={projectConfig.mainAgent}
                  onChange={(e) => handleUpdateProjectConfig('mainAgent', e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="none">None (Use Static Scanner only)</option>
                  {detectedClisOptions.map(cli => (
                    <option key={cli.id} value={cli.id}>{cli.name} ({cli.version || 'installed'})</option>
                  ))}
                  {detectedClisOptions.length === 0 && (
                    <option value="claude" disabled>Claude Code (Not detected)</option>
                  )}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Runs ADR mapping and AI-assisted repository scanning.</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Scanner Model Override</label>
                <select
                  className="form-select"
                  value={projectConfig.modelName || ''}
                  onChange={(e) => handleUpdateProjectConfig('modelName', e.target.value)}
                  style={{ width: '100%' }}
                  disabled={projectConfig.mainAgent === 'none'}
                >
                  <option value="">Default CLI Model</option>
                  {modelOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Specific model ID to use when scan runs.</span>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>
              <input
                type="checkbox"
                disabled={projectConfig.mainAgent === 'none'}
                checked={!!projectConfig.allowDangerousCli}
                onChange={(e) => handleUpdateProjectConfig('allowDangerousCli', e.target.checked)}
              />
              <span>
                <span style={{ fontWeight: 600, color: 'hsl(var(--text-primary))' }}>Enable dangerous workspace CLI permissions</span>
                <span style={{ color: 'hsl(var(--text-muted))' }}> for scan and Local CLI execution</span>
              </span>
            </label>
            <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginTop: '-14px' }}>
              Safe mode is default. Enabling this grants elevated Local CLI behaviors (file writes, tools, networking) to the workspace main agent.
            </span>
          </div>

          {/* Section 2: Custom Visual Theme (Entire App) */}
          <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-blue))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-3M9.7 9.3L14.5 4.5a1.5 1.5 0 012.1 2.1l-4.8 4.8m-2.1-2.1h.01M9.7 9.3v.01" /></svg>
              Workspace Color Theme (Entire App)
            </h4>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '16px' }}>
              {[
                { id: 'default', name: 'Midnight Slate', colors: ['#090d16', '#8b5cf6', '#f97316'] },
                { id: 'ocean', name: 'Ocean Midnight', colors: ['#040a12', '#22d3ee', '#3b82f6'] },
                { id: 'forest', name: 'Forest Dark', colors: ['#050d08', '#22c55e', '#eab308'] },
                { id: 'twilight', name: 'Twilight Plum', colors: ['#0c0612', '#d946ef', '#ec4899'] },
                { id: 'nord', name: 'Nord Freeze', colors: ['#1a2130', '#88c0d0', '#81a1c1'] },
                { id: 'cyberpunk', name: 'Cyberpunk Noir', colors: ['#000000', '#f97316', '#06b6d4'] }
              ].map(theme => {
                const isActive = contentTheme === theme.id;
                return (
                  <div
                    key={theme.id}
                    onClick={() => {
                      setContentTheme(theme.id);
                      localStorage.setItem('room_theme', theme.id);
                    }}
                    style={{
                      border: isActive ? '2px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '12px',
                      cursor: 'pointer',
                      background: 'hsl(var(--bg-input))',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      transition: 'all 0.15s ease',
                      boxShadow: isActive ? '0 0 12px hsl(var(--accent-purple) / 0.15)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {theme.colors.map((c, i) => (
                        <div key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: c, border: '1px solid rgba(255,255,255,0.1)' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: isActive ? 600 : 500, color: isActive ? 'hsl(var(--text-primary))' : 'hsl(var(--text-secondary))' }}>
                      {theme.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Content Typography */}
          <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-orange))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" /></svg>
              Content Typography (Chat & Markdown)
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Font Family</label>
                <select
                  className="form-select"
                  value={contentFontFamily}
                  onChange={(e) => {
                    setContentFontFamily(e.target.value);
                    localStorage.setItem('room_font_family', e.target.value);
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="system-ui">System UI (Default)</option>
                  <option value="'Inter', sans-serif">Inter</option>
                  <option value="'Outfit', sans-serif">Outfit</option>
                  <option value="Georgia, serif">Georgia (Serif)</option>
                  <option value="monospace">Monospace (Code)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Font Size</label>
                <select
                  className="form-select"
                  value={contentFontSize}
                  onChange={(e) => {
                    setContentFontSize(e.target.value);
                    localStorage.setItem('room_font_size', e.target.value);
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="13px">Small (13px)</option>
                  <option value="14px">Compact (14px)</option>
                  <option value="16px">Normal (16px)</option>
                  <option value="18px">Medium (18px)</option>
                  <option value="20px">Large (20px)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Line Height</label>
                <select
                  className="form-select"
                  value={contentLineHeight}
                  onChange={(e) => {
                    setContentLineHeight(e.target.value);
                    localStorage.setItem('room_line_height', e.target.value);
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="1.4">Comfortable (1.4)</option>
                  <option value="1.6">Relaxed (1.6)</option>
                  <option value="1.8">Spacious (1.8)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--text-muted))' }}>
        <h3>{activeTab} Workspace Module</h3>
        <p style={{ marginTop: '12px', fontSize: '0.9rem' }}>This component is scheduled to be wired in a subsequent sprint.</p>
      </div>
    );
  };

  const themeStyles: Record<string, string> = {
    ocean: `
      :root {
        --bg-app: 215 40% 4%;
        --bg-sidebar: 215 40% 6%;
        --bg-panel: 215 35% 8%;
        --bg-card: 215 30% 12%;
        --bg-input: 215 30% 10%;
        --accent-purple: 195 90% 50%;
        --accent-blue: 210 90% 55%;
        --glow-purple: rgba(34, 211, 238, 0.15);
        --border-glow: 195 80% 40% / 0.3;
        --border-focus: 210 90% 60% / 0.6;
      }
    `,
    forest: `
      :root {
        --bg-app: 140 30% 3%;
        --bg-sidebar: 140 30% 5%;
        --bg-panel: 140 25% 7%;
        --bg-card: 140 20% 11%;
        --bg-input: 140 20% 9%;
        --accent-purple: 142 70% 50%;
        --accent-blue: 84 70% 50%;
        --glow-purple: rgba(34, 197, 94, 0.15);
        --border-glow: 142 60% 40% / 0.3;
        --border-focus: 142 80% 50% / 0.6;
      }
    `,
    twilight: `
      :root {
        --bg-app: 280 40% 4%;
        --bg-sidebar: 280 40% 6%;
        --bg-panel: 280 35% 8%;
        --bg-card: 280 30% 12%;
        --bg-input: 280 30% 10%;
        --accent-purple: 295 85% 60%;
        --accent-blue: 320 85% 60%;
        --glow-purple: rgba(217, 70, 239, 0.15);
        --border-glow: 295 80% 50% / 0.3;
        --border-focus: 295 90% 65% / 0.6;
      }
    `,
    nord: `
      :root {
        --bg-app: 220 16% 12%;
        --bg-sidebar: 220 16% 14%;
        --bg-panel: 220 14% 17%;
        --bg-card: 220 12% 22%;
        --bg-input: 220 12% 19%;
        --accent-purple: 193 43% 67%;
        --accent-blue: 210 34% 63%;
        --glow-purple: rgba(136, 192, 208, 0.15);
        --border-glow: 193 40% 50% / 0.3;
        --border-focus: 210 40% 60% / 0.6;
      }
    `,
    cyberpunk: `
      :root {
        --bg-app: 0 0% 0%;
        --bg-sidebar: 0 0% 2%;
        --bg-panel: 0 0% 4%;
        --bg-card: 0 0% 9%;
        --bg-input: 0 0% 7%;
        --accent-purple: 24 95% 60%;
        --accent-blue: 180 100% 50%;
        --glow-purple: rgba(249, 115, 22, 0.15);
        --border-glow: 24 90% 50% / 0.4;
        --border-focus: 180 100% 50% / 0.6;
      }
    `
  };

  return (
    <>
      <style>{`
        ${themeStyles[contentTheme] || ''}
        .chat-bubble,
        .markdown-preview,
        .adr-preview,
        .focus-editor-card textarea,
        .focus-editor-card input,
        .focus-editor-card select,
        .task-list {
          font-family: ${contentFontFamily} !important;
          font-size: ${contentFontSize} !important;
          line-height: ${contentLineHeight} !important;
        }
        .message-markdown {
          color: inherit;
          overflow-wrap: anywhere;
        }
        .markdown-preview .message-markdown {
          padding: 20px 22px;
          max-width: 920px;
        }
        .message-markdown > :last-child {
          margin-bottom: 0 !important;
        }
        .message-markdown ul {
          display: flex;
          flex-direction: column;
          gap: 0.25em;
        }
        .message-markdown strong {
          color: hsl(var(--text-primary));
          font-weight: 700;
        }
        .message-markdown em {
          color: hsl(var(--text-secondary));
        }
        .message-markdown code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 0.86em;
          background: hsl(var(--bg-input));
          border: 1px solid hsl(var(--border-dim));
          border-radius: 5px;
          padding: 0.08em 0.32em;
        }
        .message-markdown pre code {
          background: transparent;
          border: 0;
          border-radius: 0;
          padding: 0;
        }
      `}</style>
      <div className="titlebar-drag">
        ROOM — AI-Native Project Workspace
      </div>
      {renderContextPickerPanel()}
      {renderOnboardingTour()}

      {projectPath === null ? (
        <div className="welcome-container" style={{ maxWidth: '640px', margin: '0 auto' }}>
          <div className="welcome-card" style={{ width: '100%' }}>
            <img className="welcome-app-icon" src="./room-icon.png" alt="ROOM" />
            <h1 className="welcome-logo">ROOM</h1>
            <p className="welcome-desc">
              Build a shared room for context, tasks, documents, roles, AI members, and discussion logs across any kind of project.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateWorkspace();
                    }
                  }}
                  disabled={loading}
                  placeholder="New workspace name"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    backgroundColor: 'hsl(var(--bg-input))',
                    border: '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    color: 'white',
                    fontFamily: 'inherit',
                    outline: 'none'
                  }}
                />
                <button className="btn-primary" onClick={handleCreateWorkspace} disabled={loading || !newWorkspaceName.trim()} style={{ whiteSpace: 'nowrap' }}>
                  {loading ? 'Creating...' : 'Create Workspace'}
                </button>
              </div>
              <button className="btn-secondary" onClick={handleOpenProject} disabled={loading}>
                {loading ? 'Opening...' : 'Open Existing Workspace'}
              </button>
            </div>
            {errorMsg && <p style={{ color: 'hsl(var(--accent-orange))', marginTop: '16px', fontSize: '0.9rem' }}>{errorMsg}</p>}

            {recentProjects.length > 0 && (
              <div style={{ marginTop: '32px', textAlign: 'left', borderTop: '1px solid hsl(var(--border-dim))', paddingTop: '24px' }}>
                <h4 style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', marginBottom: '16px', fontWeight: 600, letterSpacing: '0.05em' }}>Recent Workspaces</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {recentProjects.map((pathStr) => (
                    <button
                      key={pathStr}
                      onClick={() => handleSelectRecentProject(pathStr)}
                      disabled={loading}
                      className="btn-recent-project"
                      style={{
                        background: 'hsl(var(--bg-input))',
                        border: '1px solid hsl(var(--border-dim))',
                        color: 'hsl(var(--text-secondary))',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        outline: 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden', marginRight: '16px' }}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0, color: 'hsl(var(--accent-purple))' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span style={{ fontWeight: 600, color: 'white', flexShrink: 0 }}>{pathStr.split(/[/\\]/).pop()}</span>
                        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{pathStr}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--accent-purple))', fontWeight: 600, flexShrink: 0 }}>Open →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="app-container" style={{
          gridTemplateColumns: [
            sidebarExpanded ? '240px' : '64px',
            '1fr',
            showContextPanel ? '340px' : ''
          ].filter(Boolean).join(' ')
        }}>
          {/* Left Sidebar */}
          <aside className={`sidebar ${sidebarExpanded ? '' : 'collapsed'}`}>
            <div className="sidebar-brand">
              <img className="sidebar-brand-icon" src="./room-icon.png" alt="ROOM" />
              <span>ROOM</span>
            </div>
            
            {projectPath && (
              <div className="sidebar-project-selector" style={{ padding: '0 24px 16px 24px', borderBottom: '1px solid hsl(var(--border-dim))', marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Folder</span>
                  <button 
                    onClick={handleCloseProjectWorkspace}
                    className="btn-close-workspace"
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      color: 'hsl(var(--accent-orange))', 
                      fontSize: '0.7rem', 
                      fontWeight: 600, 
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      outline: 'none'
                    }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }} title={projectPath}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0, color: 'hsl(var(--accent-purple))' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {projectPath.split(/[/\\]/).pop()}
                  </span>
                </div>
              </div>
            )}
            
            <ul className="sidebar-menu">
              {menuItems.map((item) => {
                const isAgents = item.name === 'AI Members';
                const isItemActive = activeTab === item.name || (isAgents && activeTab.startsWith('Agent:'));
                const itemLabel = item.label || item.name;
                return (
                  <React.Fragment key={item.name}>
                    <li
                      className={`menu-item sidebar-nav-item ${isItemActive ? 'active' : ''}`}
                      onClick={() => {
                        if (isAgents) {
                          setActiveTab('AI Members');
                        } else {
                          setActiveTab(item.name);
                        }
                      }}
                      title={sidebarExpanded ? undefined : itemLabel}
                    >
                      <span className="sidebar-nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {item.icon}
                      </span>
                      <span className="sidebar-nav-label">{itemLabel}</span>
                      {isAgents && sidebarExpanded && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAiMembersSidebarExpanded(current => {
                              localStorage.setItem('room_ai_members_sidebar_expanded', String(!current));
                              return !current;
                            });
                          }}
                          title={aiMembersSidebarExpanded ? 'Collapse AI Members' : 'Expand AI Members'}
                          style={{
                            marginLeft: 'auto',
                            width: '22px',
                            height: '22px',
                            border: 0,
                            borderRadius: '6px',
                            background: 'transparent',
                            color: 'hsl(var(--text-muted))',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}
                        >
                          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d={aiMembersSidebarExpanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                          </svg>
                        </button>
                      )}
                    </li>
                    {isAgents && sidebarExpanded && aiMembersSidebarExpanded && (
                      <ul className="sidebar-submenu">
                        {(projectData?.agents || []).map((agent: any) => {
                          const isFocused = activeTab === `Agent:${agent.name}`;
                          return (
                            <li
                              key={agent.name}
                              className={`submenu-item ${isFocused ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditAgent(agent);
                              }}
                            >
                              <span style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: isFocused ? 'hsl(var(--accent-purple))' : 'hsl(var(--border-dim))',
                                display: 'inline-block'
                              }}></span>
                              <span style={{
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap'
                              }}>{agent.name}</span>
                            </li>
                          );
                        })}
                        <li
                          className={`submenu-item ${activeTab === 'Agent:New' ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            resetAgentForm();
                            setActiveTab('Agent:New');
                          }}
                          style={{ fontStyle: 'italic' }}
                        >
                          <span style={{ fontWeight: 'bold' }}>+</span>
                          <span>Register AI Member...</span>
                        </li>
                      </ul>
                    )}
                  </React.Fragment>
                );
              })}
            </ul>

            <button 
              className="sidebar-toggle-btn" 
              onClick={() => setSidebarExpanded(!sidebarExpanded)}
              title={sidebarExpanded ? "Collapse Sidebar" : "Expand Sidebar"}
            >
              {sidebarExpanded ? (
                <>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>Collapse Sidebar</span>
                </>
              ) : (
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>

            <div className="sidebar-footer" style={sidebarExpanded ? {} : { justifyContent: 'center', padding: '16px 0' }}>
              <span className="status-dot" style={{ flexShrink: 0 }}></span>
              {sidebarExpanded && <span>ROOM Engine Active</span>}
            </div>
          </aside>

          {/* Main Content Pane */}
          <main className="main-content">
            {!isRoomProject ? (
              <div className="welcome-container">
                <div className="welcome-card" style={{ maxWidth: '480px' }}>
                  <h2 style={{ marginBottom: '12px' }}>Initialize ROOM Memory</h2>
                  <p className="welcome-desc" style={{ marginBottom: '24px' }}>
                    The selected folder <code>{projectPath}</code> does not have a <code>.room/</code> workspace initialized.
                  </p>
                  <button className="btn-primary" onClick={handleInitProject} disabled={loading}>
                    {loading ? 'Initializing...' : 'Initialize .room/ directory'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <header className="timeline-header">
                  <div className="project-title-bar" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{activeTab}</h3>
                      <span className="project-badge">Active Workspace</span>
                    </div>
                    {projectPath && (
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {projectPath}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => {
                        setOnboardingStep(0);
                        setShowOnboardingTour(true);
                      }}
                      style={{
                        padding: '8px 12px',
                        fontSize: '0.85rem',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      ?
                      Tour
                    </button>
                    <button 
                      className="btn-secondary" 
                      onClick={() => setShowContextPanel(!showContextPanel)} 
                      style={{ 
                        padding: '8px 14px', 
                        fontSize: '0.85rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        height: '36px',
                        borderColor: showContextPanel ? 'hsl(var(--accent-purple))' : undefined,
                        background: showContextPanel ? 'hsl(var(--accent-purple) / 0.12)' : undefined,
                        color: showContextPanel ? 'white' : undefined,
                        cursor: 'pointer'
                      }}
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                      </svg>
                      {showContextPanel ? 'Hide Context' : 'Show Context'}
                    </button>
                  </div>
                </header>

                <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
                  {errorMsg && (
                    <div style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      color: '#ef4444',
                      fontSize: '0.85rem',
                      marginBottom: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ whiteSpace: 'pre-wrap' }}>{errorMsg}</span>
                      <button
                        onClick={() => setErrorMsg(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          marginLeft: '12px',
                          fontSize: '1rem',
                          outline: 'none'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  {renderSetupChecklist()}
                  {renderMainTab()}
                </div>
              </>
            )}
          </main>

          {/* Right Panel - Project Context */}
          {showContextPanel && (
            <section className="context-panel" style={{ width: '340px', flexShrink: 0 }}>
              <div className="panel-header">
                <span>Workspace Context</span>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>

              {projectData ? (
                <>
                  <div className="panel-section">
                    <div className="panel-section-title">Workspace Overview</div>
                    <div className="markdown-preview">
                      {projectData.projectMd || '# No description found.'}
                    </div>
                  </div>

                  <div className="panel-section">
                    <div className="panel-section-title">Context Structure</div>
                    <div className="markdown-preview">
                      {projectData.archMd || '# No architecture specifications.'}
                    </div>
                  </div>

                  <div className="panel-section">
                    <div className="panel-section-title">Legacy Decisions</div>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {projectData.decisions.length === 0 ? (
                        <li style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))' }}>No decisions registered yet.</li>
                      ) : (
                        projectData.decisions.map((dec) => (
                          <li key={dec} style={{
                            fontSize: '0.85rem',
                            background: 'hsl(var(--bg-card))',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid hsl(var(--border-dim))'
                          }}>
                            {dec}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="panel-section">
                    <div className="panel-section-title">AI Members ({(projectData.agents || []).length})</div>
                    <div className="skills-list">
                      {(projectData.agents || []).map((agent: any) => (
                        <span key={agent.name} className="skill-tag" onClick={() => setActiveTab('AI Members')}>
                          {agent.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>
                  Open and initialize a project to view workspace context metrics here.
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
