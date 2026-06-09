import React, { useState, useEffect } from 'react';
import { getFallbackModels, type ModelOption } from '@room/engine/modelCatalog';
import { parseShellArgs } from '@room/engine/shellArgs';

// Type definitions for Electron IPC API
interface ProjectData {
  projectMd: string;
  archMd: string;
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
}

interface ApiKeyStatus {
  gemini: boolean;
  anthropic: boolean;
  openai: boolean;
}

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
        tasks: string[];
        decisions: string[];
        reviews: string[];
        documents?: string[];
        discussions: string[];
        skills: string[];
        agents: any[];
        error?: string;
      }>;
      readRoomFile: (dirPath: string, section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions', filename: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      listWorkspaceFiles: (dirPath: string) => Promise<{ success: boolean; files?: WorkspaceFileEntry[]; truncated?: boolean; error?: string }>;
      readWorkspaceFile: (dirPath: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      runScan: (dirPath: string, mainAgent?: string, modelName?: string, allowDangerousCli?: boolean) => Promise<{ success: boolean; message: string }>;
      runDiscussion: (
        dirPath: string,
        topic: string,
        agentNames?: string[],
        options?: { maxRounds?: number; reviewMode?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; qualityGateCycles?: number; moderatorName?: string; autoSummary?: boolean; summaryAgentName?: string; useProjectSummaryAgent?: boolean }
      ) => Promise<{
        success: boolean;
        summary?: { filename: string; content: string };
        log?: {
          id: string;
          title: string;
          topic?: string;
          status: string;
          messages: {
            type?: 'user' | 'agent';
            agentName: string;
            providerName: string;
            content: string;
            timestamp: string;
            contextMessages?: {
              type?: 'user' | 'agent';
              agentName: string;
              providerName: string;
              timestamp: string;
            }[];
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
      onDiscussionEvent: (callback: (event: DiscussionIpcEvent) => void) => () => void;
      saveRoomFile: (dirPath: string, section: 'documents' | 'tasks', filename: string, content: string) => Promise<{ success: boolean; filename?: string; error?: string }>;
      saveContextFile: (dirPath: string, filename: 'overview.md' | 'structure.md', content: string) => Promise<{ success: boolean; error?: string }>;
      saveAgent: (dirPath: string, agent: any) => Promise<{ success: boolean; error?: string }>;
      deleteAgent: (dirPath: string, agentName: string) => Promise<{ success: boolean; error?: string }>;
      saveSkill: (dirPath: string, name: string, content: string) => Promise<{ success: boolean; error?: string }>;
      detectLocalAgents: () => Promise<{ success: boolean; agents?: DetectedAgent[]; error?: string }>;
      loadApiKeys: () => Promise<{ success: boolean; status?: ApiKeyStatus; error?: string }>;
      saveApiKeys: (keys: { geminiApiKey?: string; anthropicApiKey?: string; openaiApiKey?: string }) => Promise<{ success: boolean; status?: ApiKeyStatus; error?: string }>;
      clearApiKeys: () => Promise<{ success: boolean; status?: ApiKeyStatus; error?: string }>;
      detectCliModels: (cliId: string) => Promise<{ success: boolean; models?: { value: string; label: string }[]; error?: string }>;
      detectApiModels: (provider: string, apiKey?: string) => Promise<{ success: boolean; models?: { value: string; label: string }[]; error?: string }>;
      loadMcpConfig: (dirPath: string) => Promise<{ success: boolean; config?: any; error?: string }>;
      saveMcpConfig: (dirPath: string, config: any) => Promise<{ success: boolean; error?: string }>;
      loadProjectConfig: (dirPath: string) => Promise<{ success: boolean; config?: any; error?: string }>;
      saveProjectConfig: (dirPath: string, config: any) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

interface UIMessage {
  id?: string;
  author: string;
  role: string;
  time: string;
  text: string;
  streaming?: boolean;
  contextSummary?: string;
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
      role: string;
      round: number;
      timestamp: string;
    }
  | {
      type: 'agent_chunk';
      discussionId: string;
      agentName: string;
      providerName: string;
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

const agentLanguageInstruction = `Language policy:
- Respond in the same natural language the user uses in the current request or discussion.
- If the user mixes languages, preserve that mix when it helps clarity.
- Do not force Thai, English, or any other default language unless the user explicitly asks for it.
- Keep code identifiers, file paths, commands, API names, and quoted source text in their original language.`;

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
  Moderator: [
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
  Reporter: [
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
  ]
} satisfies Record<string, readonly TemplateSkill[]>;

const agentPersonaTemplates = [
  {
    name: 'Product',
    role: 'Product Analyst',
    provider: 'Gemini',
    skills: roleTemplateSkills.Product,
    prompt: `You are the Product Analyst for this repository.

${agentLanguageInstruction}

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
- Open Product Questions`
  },
  {
    name: 'UX',
    role: 'UX/UI Designer',
    provider: 'Claude',
    skills: roleTemplateSkills.UX,
    prompt: `You are the UX/UI Designer for this repository.

${agentLanguageInstruction}

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
- UX Risks and Questions`
  },
  {
    name: 'Screenwriter',
    role: 'Screenwriter',
    provider: 'Claude',
    skills: roleTemplateSkills.Screenwriter,
    prompt: `You are the Screenwriter for this workspace.

${agentLanguageInstruction}

Your job is to shape ideas into scenes, dialogue, character arcs, emotional beats, and story structure.
Focus on dramatic intent, pacing, conflict, subtext, scene transitions, and whether each moment earns its place.

Do not treat the workspace as a software project unless the user explicitly asks for software work.
When story details are missing, propose concrete options instead of forcing one answer.

Output format:
- Story Intent
- Character and Conflict
- Scene or Sequence Proposal
- Dialogue and Tone Notes
- Pacing Risks
- Open Story Questions`
  },
  {
    name: 'Story Editor',
    role: 'Story Editor',
    provider: 'Gemini',
    skills: roleTemplateSkills['Story Editor'],
    prompt: `You are the Story Editor for this workspace.

${agentLanguageInstruction}

Your job is to critique narrative material and make it clearer, tighter, and more emotionally coherent.
Focus on structure, continuity, character motivation, theme, audience comprehension, and weak or repetitive scenes.

Be direct about story problems, but always give actionable revision paths.

Output format:
- Editorial Summary
- What Works
- Story Problems
- Revision Recommendations
- Continuity Risks
- Questions for the Writer`
  },
  {
    name: 'Producer',
    role: 'Creative Producer',
    provider: 'Gemini',
    skills: roleTemplateSkills.Producer,
    prompt: `You are the Creative Producer for this workspace.

${agentLanguageInstruction}

Your job is to evaluate creative ideas from a production, audience, schedule, and decision-making perspective.
Focus on constraints, priorities, market fit, scope, production risks, and what needs to be decided next.

Do not over-optimize for technical implementation unless the user asks for it.

Output format:
- Producer Summary
- Audience and Positioning
- Scope and Constraints
- Production Risks
- Decision Points
- Recommended Next Steps`
  },
  {
    name: 'Researcher',
    role: 'Research Analyst',
    provider: 'Gemini',
    skills: roleTemplateSkills.Researcher,
    prompt: `You are the Research Analyst for this workspace.

${agentLanguageInstruction}

Your job is to organize uncertain topics, identify evidence needs, compare options, and separate facts from assumptions.
Focus on source quality, missing context, useful questions, and practical research paths.

If you are not given sources, label claims as assumptions and propose what should be verified.

Output format:
- Research Summary
- Known Facts
- Assumptions
- Evidence Needed
- Options or Comparisons
- Next Research Steps`
  },
  {
    name: 'Architect',
    role: 'System Architect',
    provider: 'Claude',
    skills: roleTemplateSkills.Architect,
    prompt: `You are the System Architect for this repository.

${agentLanguageInstruction}

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
- Handoff Notes for Reviewer`
  },
  {
    name: 'Implementer',
    role: 'Implementation Planner',
    provider: 'Codex',
    skills: roleTemplateSkills.Implementer,
    prompt: `You are the Implementation Planner for this repository.

${agentLanguageInstruction}

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
- Remaining Risks`
  },
  {
    name: 'Developer',
    role: 'Software Developer',
    provider: 'Codex',
    skills: roleTemplateSkills.Developer,
    prompt: `You are the Software Developer for this repository.

${agentLanguageInstruction}

Your job is to execute coding tasks inside the active workspace, using the existing codebase patterns and keeping changes narrowly scoped.
When you have local tool access, read the relevant files, edit the workspace files, and run the most relevant validation commands.

Never write files outside the active workspace.
If you cannot edit files directly, provide an exact patch-level plan and make the limitation explicit.
When reviewer feedback exists, address every required change before adding new work.

Output format:
- Work Completed
- Changed Files
- Review Feedback Addressed
- Validation
- Blockers or Remaining Risks`
  },
  {
    name: 'Reviewer',
    role: 'Senior Code Reviewer',
    provider: 'Gemini',
    skills: roleTemplateSkills.Reviewer,
    prompt: `You are the Senior Technical Reviewer for this repository.

${agentLanguageInstruction}

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

Only include [APPROVED] when OPEN_FINDINGS is empty and REQUIRED_CHANGES is empty.`
  },
  {
    name: 'Security',
    role: 'Security Reviewer',
    provider: 'Gemini',
    skills: roleTemplateSkills.Security,
    prompt: `You are the Security Reviewer for this repository.

${agentLanguageInstruction}

Your job is to identify security, privacy, permission, data exposure, injection, authentication, authorization, and unsafe local-tool risks in proposed plans.

Focus on practical exploit paths, trust boundaries, secret handling, filesystem access, network access, and user-controlled inputs.
Do not block on theoretical issues unless they create concrete implementation risk.

Output format:
- Security Summary
- Threats and Abuse Cases
- Required Safeguards
- Files or Modules to Inspect
- Security Test Requirements
- Approval Risks`
  },
  {
    name: 'QA',
    role: 'QA Reviewer',
    provider: 'Codex',
    skills: roleTemplateSkills.QA,
    prompt: `You are the QA Reviewer for this repository.

${agentLanguageInstruction}

Your job is to convert plans into verifiable behavior and catch missing test coverage before implementation starts.
Focus on acceptance criteria, edge cases, regression risk, integration flows, local CLI failure modes, and UI states.

Output format:
- Test Strategy
- Acceptance Criteria
- Edge Cases
- Regression Areas
- Manual Verification Steps
- Automation Candidates`
  },
  {
    name: 'Room Moderator',
    role: 'Room Moderator',
    provider: 'Gemini',
    skills: roleTemplateSkills.Moderator,
    prompt: `You are the Room Moderator for this workspace.

${agentLanguageInstruction}

Your job is to evaluate whether a collaborative discussion has produced a coherent and usable result.
You are not a normal contributor. Do not add new ideas unless needed to explain a gap.
Focus on whether the user goal was answered, whether agents built on each other, what remains vague, and what the next round must resolve.

Output format:
STATUS: PASS | NEEDS_MORE_DISCUSSION
SUMMARY:
GAPS:
NEXT_ROUND_INSTRUCTIONS:`
  },
  {
    name: 'Room Reporter',
    role: 'Room Reporter',
    provider: 'Gemini',
    skills: roleTemplateSkills.Reporter,
    prompt: `You are the Room Reporter for this workspace.

${agentLanguageInstruction}

Your job is to convert discussion transcripts into durable workspace memory documents.
Do not contribute new ideas. Capture what was discussed, what was decided, what remains open, and what future chats should know.
Focus on clarity, compactness, and usefulness as context for later work.

Output format:
# Chat Summary

## Executive Summary
## Key Ideas
## Decisions
## Open Questions
## Options Discussed
## Risks or Weak Points
## Next Steps
## Useful Context for Future Chats`
  }
] as const;

type TemplateRoleName = typeof agentPersonaTemplates[number]['name'];

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
  const [newAgentProvider, setNewAgentProvider] = useState<'Gemini' | 'Claude' | 'Codex' | 'Local CLI'>('Gemini');
  const [newAgentCommand, setNewAgentCommand] = useState<string>('');
  const [newAgentPrompt, setNewAgentPrompt] = useState<string>('');
  const [newAgentSkills, setNewAgentSkills] = useState<string[]>([]);
  const [newAgentPreset, setNewAgentPreset] = useState<'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none'>('none');
  const [newAgentStdinFormat, setNewAgentStdinFormat] = useState<'text' | 'json'>('text');
  const [newAgentPermissionMode, setNewAgentPermissionMode] = useState<LocalCliPermissionMode>('safe');
  const [detectedClis, setDetectedClis] = useState<DetectedAgent[]>([]);
  const [showContextPanel, setShowContextPanel] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<any | null>(null);

  // Custom workspace control states
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  const [customSkillName, setCustomSkillName] = useState<string>('');
  const [customSkillDesc, setCustomSkillDesc] = useState<string>('');
  const [newAgentModel, setNewAgentModel] = useState<string>('');
  const [newAgentModelCustom, setNewAgentModelCustom] = useState<boolean>(false);
  const [selectedTeamPresetName, setSelectedTeamPresetName] = useState<string>(teamPresets[0]?.name || '');
  const [teamPresetProvider, setTeamPresetProvider] = useState<'Gemini' | 'Claude' | 'Codex'>('Gemini');
  const [selectedDiscussionAgents, setSelectedDiscussionAgents] = useState<string[]>([]);
  const [dynamicCliModels, setDynamicCliModels] = useState<Record<string, { value: string; label: string }[]>>({});

  // MCP Client State
  const [mcpConfig, setMcpConfig] = useState<{ mcpServers: Record<string, any> }>({ mcpServers: {} });
  const [selectedMcpServer, setSelectedMcpServer] = useState<string | null>(null);
  const [mcpServerName, setMcpServerName] = useState<string>('');
  const [mcpServerCommand, setMcpServerCommand] = useState<string>('');
  const [mcpServerArgs, setMcpServerArgs] = useState<string>('');
  const [mcpServerEnv, setMcpServerEnv] = useState<string>('');

  // Main Workspace Agent & Visual Customizer State
  const [projectConfig, setProjectConfig] = useState<ProjectConfigState>({ mainAgent: 'none', allowDangerousCli: false });
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({ gemini: false, anthropic: false, openai: false });
  const [apiKeyDrafts, setApiKeyDrafts] = useState<{ geminiApiKey: string; anthropicApiKey: string; openaiApiKey: string }>({
    geminiApiKey: '',
    anthropicApiKey: '',
    openaiApiKey: ''
  });
  const [contentTheme, setContentTheme] = useState<string>(() => localStorage.getItem('room_theme') || 'default');
  const [contentFontFamily, setContentFontFamily] = useState<string>(() => localStorage.getItem('room_font_family') || 'system-ui');
  const [contentFontSize, setContentFontSize] = useState<string>(() => localStorage.getItem('room_font_size') || '16px');
  const [contentLineHeight, setContentLineHeight] = useState<string>(() => localStorage.getItem('room_line_height') || '1.6');
  const [discussionReviewMode, setDiscussionReviewMode] = useState<boolean>(true);
  const [discussionMaxRounds, setDiscussionMaxRounds] = useState<number>(6);
  const [discussionQualityGate, setDiscussionQualityGate] = useState<boolean>(false);
  const [discussionQualityGateCycles, setDiscussionQualityGateCycles] = useState<number>(1);
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
  const [activeDiscussionId, setActiveDiscussionId] = useState<string | null>(null);
  const [lastDiscussionLog, setLastDiscussionLog] = useState<any | null>(null);
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

  useEffect(() => {
    const loadApiKeyStatus = async () => {
      try {
        const res = await window.electronAPI.loadApiKeys();
        if (res.success && res.status) {
          setApiKeyStatus(res.status);
        }
      } catch (err) {
        console.error('Failed to load API key status:', err);
      }
    };
    loadApiKeyStatus();
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
          const res = await window.electronAPI.detectApiModels(newAgentProvider);
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

  // User input topic and timeline state
  const [userInputTopic, setUserInputTopic] = useState<string>('');
  const [discussionMessages, setDiscussionMessages] = useState<UIMessage[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>('');

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
        setIsRoomProject(true);
        addRecentProject(projectPath);
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
    setProjectData(null);
    setWorkspaceFiles([]);
    setWorkspaceFilesTruncated(false);
    setSelectedWorkspaceFile('');
    setSelectedWorkspaceFileContent('');
    setContextOverviewDraft('');
    setContextStructureDraft('');
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

    if (provider === 'Claude' || provider === 'Gemini' || provider === 'Codex') {
      return getFallbackModels(provider as 'Claude' | 'Gemini' | 'Codex') as ModelOption[];
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
    setNewAgentProvider('Gemini');
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
    setEditingAgent(null);
  };

  const startEditAgent = (agent: any) => {
    setEditingAgent(agent);
    setNewAgentName(agent.name);
    setNewAgentRole(agent.role);
    setNewAgentProvider(agent.provider);
    setNewAgentModel(agent.modelName || '');
    setNewAgentModelCustom(false);
    setNewAgentPrompt(agent.systemPrompt);
    setNewAgentSkills(agent.skills || []);
    setNewAgentPreset(agent.cliPreset || 'none');
    setNewAgentCommand(agent.command || '');
    setNewAgentStdinFormat(agent.stdinFormat || 'text');
    setNewAgentPermissionMode(agent.permissionMode || 'safe');
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

  const handleAddTeamPreset = async () => {
    if (!projectPath) return;
    const preset = teamPresets.find(team => team.name === selectedTeamPresetName) || teamPresets[0];
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
      const modelOptions = getModelOptions(teamPresetProvider, 'none');
      const defaultModel = modelOptions[0]?.value;

      for (const template of templatesToAdd) {
        const skillFiles = await ensureTemplateSkills(template.skills);
        const res = await window.electronAPI.saveAgent(projectPath, {
          name: template.name,
          role: template.role,
          provider: teamPresetProvider,
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
        setProjectData({
          projectMd: data.projectMd,
          archMd: data.archMd,
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
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.runScan(projectPath, projectConfig.mainAgent, projectConfig.modelName, !!projectConfig.allowDangerousCli);
      if (!res.success) {
        setErrorMsg(res.error || 'Scan failed.');
        return;
      }
      await loadProjectData(projectPath);
    } catch (err: any) {
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

  const handleSaveApiKeys = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.saveApiKeys(apiKeyDrafts);
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to save API keys.');
        return;
      }
      if (res.status) {
        setApiKeyStatus(res.status);
      }
      setApiKeyDrafts({ geminiApiKey: '', anthropicApiKey: '', openaiApiKey: '' });
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save API keys.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearApiKeys = async () => {
    const confirmed = window.confirm('Clear all locally stored API keys for this machine?');
    if (!confirmed) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await window.electronAPI.clearApiKeys();
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to clear API keys.');
        return;
      }
      if (res.status) {
        setApiKeyStatus(res.status);
      }
      setApiKeyDrafts({ geminiApiKey: '', anthropicApiKey: '', openaiApiKey: '' });
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to clear API keys.');
    } finally {
      setLoading(false);
    }
  };

  const loadRoomFilePreview = async (
    section: 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions',
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

  const toggleDiscussionContextRef = (ref: string) => {
    setSelectedDiscussionContextRefs(prev =>
      prev.includes(ref)
        ? prev.filter(item => item !== ref)
        : [...prev, ref]
    );
  };

  const toggleCodingTaskContextRef = (ref: string) => {
    setSelectedCodingTaskContextRefs(prev =>
      prev.includes(ref)
        ? prev.filter(item => item !== ref)
        : [...prev, ref]
    );
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

  const getDiscussionIdFromFile = (filename: string) => filename.replace(/\.(md|json)$/i, '');

  const formatDiscussionLogMessages = (log: any): UIMessage[] => {
    const messages = Array.isArray(log?.messages) ? log.messages : [];
    return messages.map((message: any) => {
      if (message.type === 'user') {
        return {
          author: 'You',
          role: 'user',
          time: message.timestamp || '',
          text: message.content || ''
        };
      }

      const contextCount = Array.isArray(message.contextMessages) ? message.contextMessages.length : 0;
      return {
        author: `${message.agentName} (${message.providerName})`,
        role: String(message.agentName || 'agent').toLowerCase(),
        time: message.timestamp || '',
        text: message.content || '',
        contextSummary: contextCount > 0
          ? `Context: ${contextCount} chat message${contextCount === 1 ? '' : 's'}`
          : 'Context: current message only'
      };
    });
  };

  const startNewDiscussion = () => {
    setActiveDiscussionId(null);
    setLastDiscussionLog(null);
    setLastDiscussionTopic('');
    setDiscussionMessages([]);
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
    const filename = section === 'documents'
      ? `discussion-${timestamp}-summary.md`
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
    const task = codingTaskInput.trim();
    setCodingTaskInput('');
    setCodingTaskMessages([
      {
        author: 'You',
        role: 'user',
        time: new Date().toLocaleTimeString(),
        text: task
      },
      {
        author: 'System Engine',
        role: 'system',
        time: new Date().toLocaleTimeString(),
        text: `Starting ${taskRunType} task with ${codingTaskDeveloperName}, then review by ${codingTaskReviewerNames.join(', ')}.`
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
            author: `${event.agentName} (${event.providerName})`,
            role: event.agentName.toLowerCase(),
            time: event.timestamp,
            text: '',
            streaming: true,
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
            return { ...msg, text: `${msg.text}${event.chunk}`, streaming: true };
          });
          if (found) return updated;
          return [
            ...updated,
            {
              id,
              author: `${event.agentName} (${event.providerName})`,
              role: event.agentName.toLowerCase(),
              time: new Date().toLocaleTimeString(),
              text: event.chunk,
              streaming: true
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
              contextSummary: `Cycle ${event.round} • Context: ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
            };
          });
          if (found) return updated;
          return [
            ...updated,
            {
              id,
              author: `${event.message.agentName} (${event.message.providerName})`,
              role: event.message.agentName.toLowerCase(),
              time: event.message.timestamp,
              text: event.message.content,
              streaming: false,
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
            author: `${event.agentName} (${event.providerName})`,
            role: event.agentName.toLowerCase(),
            time: event.timestamp,
            text: '',
            streaming: true
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
              ...msg,
              text: `${msg.text}${event.chunk}`,
              streaming: true
            };
          });

          if (found) return updated;

          return [
            ...updated,
            {
              id,
              author: `${event.agentName} (${event.providerName})`,
              role: event.agentName.toLowerCase(),
              time: new Date().toLocaleTimeString(),
              text: event.chunk,
              streaming: true
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
              contextSummary
            };
          });

          if (found) return updated;

          return [
            ...updated,
            {
              id,
              author: `${event.message.agentName} (${event.message.providerName})`,
              role: event.message.agentName.toLowerCase(),
              time: event.message.timestamp,
              text: event.message.content,
              streaming: false,
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
        maxRounds: discussionReviewMode ? discussionMaxRounds : 2,
        contextRefs,
        discussionId: activeDiscussionId || undefined,
        qualityGate: discussionQualityGate,
        qualityGateCycles: discussionQualityGateCycles,
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
        const statusMessage = discussionReviewMode
          ? [{
              author: 'System Engine',
              role: 'system',
              time: new Date().toLocaleTimeString(),
              text: res.log.status === 'approved'
                ? 'Review loop completed: output passed the active gate.'
                : 'Review loop stopped with findings still needing revision.'
            }]
          : [];
        const summaryMessage = res.summary?.filename
          ? [{
              author: 'System Engine',
              role: 'system',
              time: new Date().toLocaleTimeString(),
              text: `Auto Summary saved to Documents: ${res.summary.filename}`
            }]
          : [];
        setDiscussionMessages([...formatted, ...statusMessage, ...summaryMessage]);
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
    { name: 'Tasks', icon: (
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
      const contextOptions = [
        { ref: 'workspace:overview', label: 'Workspace Overview' },
        { ref: 'workspace:structure', label: 'Workspace Structure' },
        ...discussionFiles.slice(0, 6).map(file => ({ ref: `discussion:${file}`, label: `Chat Ref: ${file}` })),
        ...(projectData?.documents || []).slice(0, 12).map(file => ({ ref: `document:${file}`, label: `Doc: ${file}` })),
        ...(projectData?.tasks || []).slice(0, 8).map(file => ({ ref: `task:${file}`, label: `Task: ${file}` })),
        ...workspaceFiles
          .filter(file => !file.path.startsWith('.room/'))
          .slice(0, 16)
          .map(file => ({ ref: `file:${file.path}`, label: `File: ${file.path}` }))
      ];

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
            {discussionMessages.map((msg, idx) => {
              const alignment = getAlignment(msg.role, idx);
              return (
                <div
                  key={idx}
                  className={`chat-bubble ${msg.role}`}
                  style={{
                    alignSelf: alignment,
                    borderStyle: msg.role === 'system' ? 'dashed' : 'solid',
                    borderColor: msg.role === 'system' ? 'hsl(var(--accent-orange) / 0.5)' : undefined,
                    maxWidth: msg.role === 'system' ? '90%' : '80%'
                  }}
                >
                  <div className="bubble-meta">
                    <span className="bubble-author">{msg.author}</span>
                    <span>{msg.streaming ? 'Streaming...' : msg.time}</span>
                  </div>
                  {msg.contextSummary && (
                    <div style={{
                      fontSize: '0.72rem',
                      color: 'hsl(var(--text-muted))',
                      marginBottom: '8px'
                    }}>
                      {msg.contextSummary}
                    </div>
                  )}
                  <p style={{ whiteSpace: 'pre-wrap' }}>{msg.text || (msg.streaming ? 'Waiting for output...' : '')}</p>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 16px', background: 'hsl(var(--bg-sidebar))', borderRadius: '12px', border: '1px solid hsl(var(--border-dim))', marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase' }}>
                Context Picker
              </span>
              <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
                {selectedDiscussionContextRefs.length} selected
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '92px', overflowY: 'auto' }}>
              {contextOptions.map(option => {
                const selected = selectedDiscussionContextRefs.includes(option.ref);
                return (
                  <label
                    key={option.ref}
                    className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                    title={option.label}
                    style={{ fontSize: '0.72rem', padding: '4px 10px', borderRadius: '14px', maxWidth: '260px' }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={loading}
                      onChange={() => toggleDiscussionContextRef(option.ref)}
                    />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selected ? '✓ ' : '+ '}
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </div>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
              Gate cycles
              <select
                className="form-select"
                value={discussionQualityGateCycles}
                disabled={loading || !discussionQualityGate}
                onChange={(e) => setDiscussionQualityGateCycles(Number(e.target.value))}
                style={{ height: '30px', minWidth: '64px', fontSize: '0.78rem', padding: '0 8px' }}
              >
                {[1, 2, 3].map(cycles => (
                  <option key={cycles} value={cycles}>{cycles}</option>
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
            </div>
          )}
        </div>
      );
    }

    if (activeTab === 'Task Run') {
      const agents = projectData?.agents || [];
      const taskFiles = (projectData?.tasks || [])
        .filter(file => file.toLowerCase().endsWith('.md'))
        .sort((a, b) => b.localeCompare(a));
      const contextOptions = [
        { ref: 'workspace:overview', label: 'Workspace Overview' },
        { ref: 'workspace:structure', label: 'Workspace Structure' },
        ...(projectData?.documents || []).slice(0, 10).map(file => ({ ref: `document:${file}`, label: `Doc: ${file}` })),
        ...taskFiles.slice(0, 8).map(file => ({ ref: `task:${file}`, label: `Task: ${file}` })),
        ...(projectData?.discussions || []).slice(0, 6).map(file => ({ ref: `discussion:${file}`, label: `Chat Ref: ${file}` })),
        ...workspaceFiles
          .filter(file => !file.path.startsWith('.room/'))
          .slice(0, 20)
          .map(file => ({ ref: `file:${file.path}`, label: `File: ${file.path}` }))
      ];

      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: '24px', height: '100%', minHeight: '620px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                Task
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
              <textarea
                value={codingTaskInput}
                onChange={(e) => setCodingTaskInput(e.target.value)}
                disabled={loading}
                placeholder="Describe the work you want the selected AI member to produce..."
                rows={8}
                style={{
                  width: '100%',
                  minHeight: '160px',
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
	                          <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
	                            Custom commands run exactly as entered from the workspace directory. Safe mode does not sandbox custom commands; it only avoids elevated flags for known CLI presets.
	                          </span>
	                        </div>

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
                    <option key={agent.name} value={agent.name}>{agent.name} — {agent.role}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
                  Reviewers / Leads
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '100px', overflowY: 'auto' }}>
                  {agents.map((agent: any) => {
                    const selected = codingTaskReviewerNames.includes(agent.name);
                    const disabled = loading || agent.name === codingTaskDeveloperName;
                    return (
                      <label
                        key={agent.name}
                        className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                        style={{ fontSize: '0.74rem', padding: '4px 10px', borderRadius: '14px', opacity: disabled && !selected ? 0.55 : 1 }}
                        title={`${agent.name} — ${agent.role}`}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
                  Task Context
                </span>
                <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
                  {selectedCodingTaskContextRefs.length} selected
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '136px', overflowY: 'auto' }}>
                {contextOptions.map(option => {
                  const selected = selectedCodingTaskContextRefs.includes(option.ref);
                  return (
                    <label
                      key={option.ref}
                      className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                      title={option.label}
                      style={{ fontSize: '0.72rem', padding: '4px 10px', borderRadius: '14px', maxWidth: '260px' }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={loading}
                        onChange={() => toggleCodingTaskContextRef(option.ref)}
                      />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selected ? '✓ ' : '+ '}
                        {option.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              className="btn-primary"
              type="button"
              onClick={handleRunCodingTask}
              disabled={loading || !codingTaskInput.trim() || !codingTaskDeveloperName || codingTaskReviewerNames.length === 0}
              style={{ height: '42px', justifyContent: 'center' }}
            >
              {loading ? 'Running Task...' : 'Run Doer → Review Loop'}
            </button>

            {lastCodingTaskResult?.markdownFilename && (
              <div style={{ display: 'grid', gridTemplateColumns: lastCodingTaskResult.artifactFilename ? '1fr 1fr' : '1fr', gap: '8px' }}>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    loadRoomFilePreview('tasks', lastCodingTaskResult.markdownFilename);
                    setActiveTab('Tasks');
                  }}
                  style={{ height: '38px', justifyContent: 'center' }}
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
                    style={{ height: '38px', justifyContent: 'center' }}
                  >
                    Open Artifact
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
                  Task Run
                </div>
                <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))', marginTop: '4px' }}>
                  The selected Doer produces the work first, then reviewers decide whether to approve or send it back.
                </div>
              </div>
              {lastCodingTaskResult && (
                <span className="project-badge" style={{ borderColor: lastCodingTaskResult.status === 'approved' ? '#10b981' : 'hsl(var(--accent-orange))', color: lastCodingTaskResult.status === 'approved' ? '#10b981' : 'hsl(var(--accent-orange))' }}>
                  {lastCodingTaskResult.status}
                </span>
              )}
            </div>

            {lastCodingTaskResult && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Cycles</div>
                  <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{lastCodingTaskResult.cycles}</div>
                </div>
                <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Approved By</div>
                  <div style={{ marginTop: '4px', color: 'white', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lastCodingTaskResult.approvedBy?.length ? lastCodingTaskResult.approvedBy.join(', ') : 'Not approved'}
                  </div>
                </div>
                <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Artifact</div>
                  <div style={{ marginTop: '4px', color: 'white', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lastCodingTaskResult.artifactFilename || 'None'}
                  </div>
                </div>
                {lastCodingTaskResult.statusSummary && (
                  <div style={{ gridColumn: '1 / -1', padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', color: 'hsl(var(--text-secondary))', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>
                    {lastCodingTaskResult.statusSummary}
                  </div>
                )}
              </div>
            )}

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px', paddingRight: '6px' }}>
              {codingTaskMessages.length === 0 ? (
                <div className="markdown-preview" style={{ maxHeight: 'none', height: '100%', minHeight: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>
                  No task run yet.
                </div>
              ) : (
                codingTaskMessages.map((msg, idx) => (
                  <div
                    key={`${msg.id || msg.author}-${idx}`}
                    className={`chat-bubble ${msg.role}`}
                    style={{
                      alignSelf: msg.role === 'system' ? 'center' : idx % 2 === 0 ? 'flex-start' : 'flex-end',
                      borderStyle: msg.role === 'system' ? 'dashed' : 'solid',
                      borderColor: msg.role === 'system' ? 'hsl(var(--accent-orange) / 0.5)' : undefined,
                      maxWidth: msg.role === 'system' ? '92%' : '86%'
                    }}
                  >
                    <div className="bubble-meta">
                      <span className="bubble-author">{msg.author}</span>
                      <span>{msg.streaming ? 'Streaming...' : msg.time}</span>
                    </div>
                    {msg.contextSummary && (
                      <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
                        {msg.contextSummary}
                      </div>
                    )}
                    <p style={{ whiteSpace: 'pre-wrap' }}>{msg.text || (msg.streaming ? 'Waiting for output...' : '')}</p>
                  </div>
                ))
              )}
            </div>
          </div>
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
                  Choose what you are working on, then add the suggested AI members. Existing members are skipped.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  className="form-select"
                  value={selectedTeamPresetName}
                  disabled={loading}
                  onChange={(e) => setSelectedTeamPresetName(e.target.value)}
                  style={{ minWidth: '220px', height: '36px', fontSize: '0.82rem' }}
                >
                  {teamPresets.map(team => (
                    <option key={team.name} value={team.name}>{team.name}</option>
                  ))}
                </select>
                <select
                  className="form-select"
                  value={teamPresetProvider}
                  disabled={loading}
                  onChange={(e) => setTeamPresetProvider(e.target.value as 'Gemini' | 'Claude' | 'Codex')}
                  style={{ minWidth: '130px', height: '36px', fontSize: '0.82rem' }}
                >
                  <option value="Gemini">Gemini</option>
                  <option value="Claude">Claude</option>
                  <option value="Codex">Codex</option>
                </select>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={handleAddTeamPreset}
                  disabled={loading}
                  style={{ height: '36px', padding: '0 16px', fontSize: '0.82rem' }}
                >
                  Add Team
                </button>
              </div>
            </div>
            {(() => {
              const selectedTeam = teamPresets.find(team => team.name === selectedTeamPresetName) || teamPresets[0];
              if (!selectedTeam) return null;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))' }}>
                    {selectedTeam.description}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {selectedTeam.roles.map(role => {
                      const exists = agents.some((agent: any) => String(agent.name).toLowerCase() === role.toLowerCase());
                      return (
                        <span
                          key={role}
                          style={{
                            background: exists ? 'hsl(var(--bg-input))' : 'hsl(var(--accent-purple) / 0.12)',
                            border: exists ? '1px solid hsl(var(--border-dim))' : '1px solid hsl(var(--accent-purple) / 0.35)',
                            color: exists ? 'hsl(var(--text-muted))' : 'hsl(var(--text-secondary))',
                            fontSize: '0.72rem',
                            padding: '4px 9px',
                            borderRadius: '14px'
                          }}
                        >
                          {role}{exists ? ' · added' : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
              {agents.map((agent: any, idx: number) => {
                const providerClass = agent.provider.toLowerCase();
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
                    padding: '16px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
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
                        {agent.provider}
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

                    {agent.skills && agent.skills.length > 0 && (
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
                      } else {
                        setNewAgentProvider(val as any);
                        setNewAgentPreset('none');
                        setNewAgentPermissionMode('safe');
                        const defaults = getModelOptions(val);
                        setNewAgentModelCustom(false);
                        setNewAgentModel(defaults[0]?.value || '');
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
                    <optgroup label="Cloud Providers">
                      <option value="Gemini">Gemini (Google)</option>
                      <option value="Claude">Claude (Anthropic)</option>
                      <option value="Codex">Codex (OpenAI)</option>
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
                            onChange={(e) => setNewAgentStdinFormat(e.target.value as any)}
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
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Assign Skills</label>
                {availableSkills.length === 0 ? (
                  <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>No skills found. Create a custom skill below or save an agent without skills.</span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {availableSkills.map((skill) => {
                      const isSelected = newAgentSkills.includes(skill);
                      return (
                        <label 
                          key={skill} 
                          className={`skill-checkbox-chip ${isSelected ? 'selected' : ''}`}
                        >
                          <input 
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setNewAgentSkills(prev => 
                                prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
                              );
                            }}
                          />
                          {isSelected ? '✓ ' : '+ '}
                          {skill.replace('.md', '').replace(/-/g, ' ')}
                        </label>
                      );
                    })}
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
            {selectedDecisionContent || (decisions.length > 0 ? '# Select an ADR to preview.' : '# No decision records found.')}
          </div>
        </div>
      );
    }

    if (activeTab === 'Tasks') {
      const tasks = projectData?.tasks || [];
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', minHeight: '520px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
              Workspace task notes logged under <code>.room/tasks/</code>.
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
            {selectedTaskContent || (tasks.length > 0 ? '# Select a task file to preview.' : '# No task files found.')}
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
              Documents from <code>.room/documents/</code>. If empty, markdown discussion transcripts from <code>.room/discussions/</code> are shown.
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
            {selectedReviewContent || (items.length > 0 ? '# Select a review or discussion log to preview.' : '# No review logs found.')}
          </div>
        </div>
      );
    }

    if (activeTab === 'Files') {
      const query = workspaceFileSearch.trim().toLowerCase();
      const visibleFiles = query
        ? workspaceFiles.filter(file => file.path.toLowerCase().includes(query))
        : workspaceFiles;

      return (
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '24px', minHeight: '560px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="search"
                value={workspaceFileSearch}
                onChange={(e) => setWorkspaceFileSearch(e.target.value)}
                placeholder="Search workspace files..."
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
                {visibleFiles.length} files{workspaceFilesTruncated ? ' shown. Large folders are limited to the first 500 files.' : ''}
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
                <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No workspace files found.</div>
              ) : (
                visibleFiles.map((file) => {
                  const selected = selectedWorkspaceFile === file.path;
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
                      <div style={{ fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.path}
                      </div>
                      <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem', marginTop: '4px' }}>
                        {formatFileSize(file.size)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', minHeight: '20px', wordBreak: 'break-all' }}>
              {selectedWorkspaceFile || 'Select a file to preview.'}
            </div>
            <pre className="markdown-preview" style={{
              maxHeight: 'none',
              height: '520px',
              fontSize: '0.86rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0
            }}>
              {selectedWorkspaceFileContent || '# Select a workspace file to preview.'}
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
          {/* Section 0: Local API Keys */}
          <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-green))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H3v-4l6.257-6.257A6 6 0 1121 9z" />
              </svg>
              API Keys
            </h4>
            <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5 }}>
              Stored locally on this machine, outside <code>.room/</code>. Leave a field blank to keep the existing key.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
              {[
                {
                  id: 'geminiApiKey',
                  label: 'Gemini API Key',
                  configured: apiKeyStatus.gemini,
                  placeholder: apiKeyStatus.gemini ? 'Configured. Enter a new key to replace.' : 'Paste Gemini API key'
                },
                {
                  id: 'anthropicApiKey',
                  label: 'Anthropic API Key',
                  configured: apiKeyStatus.anthropic,
                  placeholder: apiKeyStatus.anthropic ? 'Configured. Enter a new key to replace.' : 'Paste Anthropic API key'
                },
                {
                  id: 'openaiApiKey',
                  label: 'OpenAI API Key',
                  configured: apiKeyStatus.openai,
                  placeholder: apiKeyStatus.openai ? 'Configured. Enter a new key to replace.' : 'Paste OpenAI API key'
                }
              ].map(field => (
                <div key={field.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>{field.label}</label>
                    <span style={{
                      fontSize: '0.68rem',
                      color: field.configured ? '#10b981' : 'hsl(var(--text-muted))',
                      background: field.configured ? 'rgba(16, 185, 129, 0.1)' : 'hsl(var(--bg-input))',
                      border: field.configured ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid hsl(var(--border-dim))',
                      borderRadius: '10px',
                      padding: '2px 7px',
                      whiteSpace: 'nowrap'
                    }}>
                      {field.configured ? 'Configured' : 'Not set'}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={apiKeyDrafts[field.id as keyof typeof apiKeyDrafts]}
                    disabled={loading}
                    onChange={(e) => setApiKeyDrafts(prev => ({ ...prev, [field.id]: e.target.value }))}
                    placeholder={field.placeholder}
                    style={{
                      backgroundColor: 'hsl(var(--bg-input))',
                      border: '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'white',
                      fontFamily: 'inherit',
                      fontSize: '0.86rem',
                      outline: 'none',
                      width: '100%'
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center' }}>
              <button type="button" className="btn-secondary" onClick={handleClearApiKeys} disabled={loading} style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem' }}>
                Clear API Keys
              </button>
              <button type="button" className="btn-primary" onClick={handleSaveApiKeys} disabled={loading} style={{ height: '36px', padding: '0 18px', fontSize: '0.8rem' }}>
                {loading ? 'Saving...' : 'Save API Keys'}
              </button>
            </div>
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
      `}</style>
      <div className="titlebar-drag">
        ROOM — AI-Native Project Workspace
      </div>

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
                      title={sidebarExpanded ? undefined : item.name}
                    >
                      <span className="sidebar-nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {item.icon}
                      </span>
                      <span className="sidebar-nav-label">{item.name}</span>
                    </li>
                    {isAgents && sidebarExpanded && (
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
                    <button className="btn-primary" onClick={triggerScan} disabled={loading} style={{ padding: '8px 16px', fontSize: '0.85rem', height: '36px', display: 'flex', alignItems: 'center' }}>
                      {loading ? 'Scanning...' : 'Scan Repository'}
                    </button>
                  </div>
                </header>

                <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
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
