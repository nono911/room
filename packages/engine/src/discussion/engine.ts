import * as fs from 'fs/promises';
import * as path from 'path';
import { loadAgents, AgentConfig } from '../agents/registry.js';
import { GeminiProvider } from '../providers/gemini.js';
import { ClaudeProvider } from '../providers/claude.js';
import { CodexProvider } from '../providers/codex.js';
import { LocalCliProvider } from '../providers/localCli.js';
import { Provider } from '../providers/provider.js';

export interface DiscussionMessage {
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
}

export interface DiscussionLog {
  id: string;
  title: string;
  topic?: string;
  status: 'active' | 'completed' | 'approved' | 'needs_revision' | 'blocked';
  messages: DiscussionMessage[];
}

export type DiscussionEvent =
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
      message: DiscussionMessage;
      round: number;
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
      log: DiscussionLog;
    };

export interface DiscussionRunOptions {
  onEvent?: (event: DiscussionEvent) => void;
  reviewMode?: boolean;
  additionalContext?: string;
  userLabel?: string;
}

export interface QualityGateResult {
  status: 'PASS' | 'NEEDS_MORE_DISCUSSION';
  content: string;
  nextRoundInstructions: string;
}

export interface CodingTaskResult {
  id: string;
  title: string;
  task: string;
  taskType?: string;
  status: 'approved' | 'needs_revision' | 'blocked';
  cycles: number;
  messages: DiscussionMessage[];
  markdownFilename: string;
  jsonFilename: string;
  artifactFilename?: string;
  approvedBy?: string[];
  statusSummary?: string;
}

export interface CodingTaskRunOptions {
  onEvent?: (event: DiscussionEvent) => void;
  additionalContext?: string;
  taskType?: string;
}

const LANGUAGE_POLICY = `=== Language Policy ===
Respond in the same natural language the user uses in the current discussion topic.
If the user mixes languages, preserve that mix when it helps clarity.
Do not force Thai, English, or any other default language unless the user explicitly asks for it.
Keep code identifiers, file paths, commands, API names, and quoted source text in their original language.`;

const DISCUSSION_PROTOCOL = `=== Discussion Protocol ===
This is a collaborative chat, not a set of isolated answers.
When there is prior chat history, explicitly reference at least one concrete point from the previous user or AI messages.
State whether you are building on, refining, challenging, or resolving that point before adding your own contribution.
Avoid restarting from scratch unless the user asks for a new direction.`;

function renderDiscussionMarkdown(log: DiscussionLog): string {
  const messages = log.messages.map((message, index) => {
    if (message.type === 'user') {
      return `## ${index + 1}. ${message.agentName}

${message.content.trim()}
`;
    }

    const contextMessages = message.contextMessages || [];
    const contextSummary = contextMessages.length > 0
      ? contextMessages.map(contextMessage => `- ${contextMessage.agentName} (${contextMessage.providerName}) at ${contextMessage.timestamp}`).join('\n')
      : '- Current user message only; no previous chat messages yet.';

    return `## ${index + 1}. ${message.agentName} (${message.providerName})

### Context received
${contextSummary}

### Response

${message.content.trim()}
`;
  }).join('\n');

  return `# ${log.title}

## Current Topic
${log.topic || 'Untitled'}

## Status
${log.status}

## Transcript
${messages || 'No messages yet.'}
`;
}

function renderCodingTaskMarkdown(result: CodingTaskResult): string {
  const messages = result.messages.map((message, index) => {
    const label = message.type === 'user'
      ? message.agentName
      : `${message.agentName} (${message.providerName})`;
    return `## ${index + 1}. ${label}

${message.content.trim()}
`;
  }).join('\n');

  return `# ${result.title}

## Task
${result.task}

## Task Type
${result.taskType || 'general'}

## Status
${result.status}

## Cycles
${result.cycles}

## Approved By
${result.approvedBy && result.approvedBy.length > 0 ? result.approvedBy.map(name => `- ${name}`).join('\n') : '- Not approved yet'}

## Artifact
${result.artifactFilename ? result.artifactFilename : 'No artifact saved yet.'}

## Status Summary
${result.statusSummary || 'No status summary yet.'}

## Transcript
${messages || 'No messages yet.'}
`;
}

function renderTaskArtifact(result: CodingTaskResult, doerMessage: DiscussionMessage | null): string {
  const artifactTitle = result.taskType === 'coding'
    ? `Implementation Report: ${result.task}`
    : `Task Artifact: ${result.task}`;
  const source = doerMessage?.content?.trim() || 'No deliverable content was produced.';
  return `# ${artifactTitle}

## Task Type
${result.taskType || 'general'}

## Status
${result.status}

## Review Cycles
${result.cycles}

## Approved By
${result.approvedBy && result.approvedBy.length > 0 ? result.approvedBy.map(name => `- ${name}`).join('\n') : '- Not approved yet'}

## Summary
${result.statusSummary || 'No status summary available.'}

## Deliverable
${source}
`;
}

export class DiscussionEngine {
  private dirPath: string;

  constructor(dirPath: string) {
    this.dirPath = dirPath;
  }

  private getProvider(agent: AgentConfig): Provider {
    switch (agent.provider) {
      case 'Claude':
        return new ClaudeProvider({ modelName: agent.modelName });
      case 'Gemini':
        return new GeminiProvider({ modelName: agent.modelName });
      case 'Codex':
        return new CodexProvider({ modelName: agent.modelName });
      case 'Local CLI':
        return new LocalCliProvider({
          command: agent.command,
          cliPreset: agent.cliPreset,
          stdinFormat: agent.stdinFormat,
          cwd: this.dirPath,
          modelName: agent.modelName,
          permissionMode: agent.permissionMode || 'safe'
        });
      default:
      return new GeminiProvider({ modelName: agent.modelName });
    }
  }

  private async isDangerousLocalCliAllowed(): Promise<boolean> {
    try {
      const configPath = path.join(this.dirPath, '.room', 'config.json');
      const parsed = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { allowDangerousCli?: unknown };
      return parsed.allowDangerousCli === true;
    } catch {
      return false;
    }
  }

  private async assertAgentExecutionAllowed(agent: AgentConfig): Promise<void> {
    if (agent.provider === 'Local CLI' && agent.permissionMode === 'dangerous') {
      const allowed = await this.isDangerousLocalCliAllowed();
      if (!allowed) {
        throw new Error(`Dangerous Local CLI agent "${agent.name}" requires workspace dangerous mode to be enabled in .room/config.json.`);
      }
    }
  }

  private async readFirstExistingFile(paths: string[]): Promise<string> {
    for (const filePath of paths) {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch {}
    }
    return '';
  }

  private async resolveSkillPath(skillFile: string): Promise<string> {
    const trimmedSkillFile = (skillFile || '').trim();
    if (/[\\/]/.test(trimmedSkillFile)) {
      throw new Error(`Unsafe skill filename: ${skillFile}`);
    }

    const safeName = path.basename(trimmedSkillFile);
    if (!safeName || !safeName.toLowerCase().endsWith('.md')) {
      throw new Error(`Unsafe or unsupported skill filename: ${skillFile}`);
    }

    const dirs = [
      path.resolve(this.dirPath, '.room', 'roles'),
      path.resolve(this.dirPath, '.room', 'skills')
    ];

    for (const skillsDir of dirs) {
      const resolvedPath = path.resolve(skillsDir, safeName);
      const relativeToSkills = path.relative(skillsDir, resolvedPath);
      if (relativeToSkills.startsWith('..') || path.isAbsolute(relativeToSkills)) {
        throw new Error(`Unsafe skill filename: ${skillFile}`);
      }

      try {
        await fs.access(resolvedPath);
        return resolvedPath;
      } catch {}
    }

    return path.resolve(dirs[0], safeName);
  }

  private isReviewerAgent(agent: AgentConfig): boolean {
    const name = agent.name.toLowerCase();
    const role = agent.role.toLowerCase();
    return name.includes('reviewer') || role.includes('review') || role.includes('audit');
  }

  private buildReviewProtocol(agent: AgentConfig): string {
    if (this.isReviewerAgent(agent)) {
      return `

=== Review Loop Protocol ===
You are responsible for finding and tracking implementation gaps.
Respond with these sections:
- OPEN_FINDINGS: unresolved blocker/major/minor findings, each with concrete rationale.
- RESOLVED_FINDINGS: findings from prior rounds that are now closed.
- REQUIRED_CHANGES: specific changes needed before approval.
- APPROVAL_STATUS: NEEDS_REVISION or APPROVED.

Only include [APPROVED] when OPEN_FINDINGS is empty and the technical plan is implementable with clear tests. If any meaningful gap remains, do not include [APPROVED].`;
    }

    return `

=== Review Loop Protocol ===
If prior agents raised OPEN_FINDINGS or REQUIRED_CHANGES, explicitly address each item before adding new scope. Produce a concrete technical plan with affected modules, implementation steps, and tests.`;
  }

  private safeDocumentSlug(input: string): string {
    return (input || 'discussion')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'discussion';
  }

  private isDeveloperAgent(agent: AgentConfig): boolean {
    const text = `${agent.name} ${agent.role}`.toLowerCase();
    return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('coder');
  }

  private parseCodingApproval(contents: string[]): boolean {
    if (contents.length === 0) return false;
    return contents.every(content => {
      return this.isExplicitlyApproved(content);
    });
  }

  private isExplicitlyApproved(content: string): boolean {
    const statusMatch = content.match(/^\s*-?\s*APPROVAL_STATUS\s*:\s*([A-Z_ -]+)\s*$/im);
    const status = statusMatch?.[1]?.trim().toUpperCase().replace(/\s+/g, '_');
    if (status !== 'APPROVED') {
      return false;
    }

    const openFindings = content.match(/(?:^|\n)\s*-?\s*OPEN_FINDINGS\s*:?\s*([\s\S]*?)(?=\n\s*-?\s*(?:RESOLVED_FINDINGS|REQUIRED_CHANGES|TEST_REQUIREMENTS|VALIDATION_NOTES|APPROVAL_STATUS)\s*:|\s*$)/i)?.[1]?.trim();
    if (!openFindings) {
      return true;
    }

    const normalized = openFindings
      .replace(/^[-*\s]+/gm, '')
      .replace(/\b(none|no open findings|empty|n\/a|null)\b/gi, '')
      .trim();
    return normalized.length === 0;
  }

  private extractTaskReviewSummary(contents: string[]): string {
    const summaries = contents.map((content, index) => {
      const reviewSummary = content.match(/REVIEW_SUMMARY\s*:?\s*([\s\S]*?)(?:\n-\s*OPEN_FINDINGS|\nOPEN_FINDINGS\s*:|\n-\s*REQUIRED_CHANGES|\nREQUIRED_CHANGES\s*:|\n-\s*VALIDATION_NOTES|\nVALIDATION_NOTES\s*:|\n-\s*APPROVAL_STATUS|\nAPPROVAL_STATUS\s*:|$)/i)?.[1]?.trim();
      const status = content.match(/APPROVAL_STATUS\s*:?\s*([^\n]+)/i)?.[1]?.trim();
      return `Reviewer ${index + 1}${status ? ` (${status})` : ''}: ${reviewSummary || content.trim().split('\n').slice(0, 3).join(' ')}`;
    });
    return summaries.join('\n');
  }

  private parseQualityGateResult(content: string): QualityGateResult {
    const statusLine = content
      .split('\n')
      .map(line => line.trim().toUpperCase())
      .find(line => {
        if (!line.startsWith('STATUS:')) return false;
        const hasPass = line.includes('PASS');
        const hasNeedsMoreDiscussion = line.includes('NEEDS_MORE_DISCUSSION');
        return hasPass !== hasNeedsMoreDiscussion;
      });
    const status = statusLine?.includes('PASS') ? 'PASS' : 'NEEDS_MORE_DISCUSSION';
    const nextMatch = content.match(/NEXT_ROUND_INSTRUCTIONS:\s*([\s\S]*)/i);
    const nextRoundInstructions = nextMatch?.[1]?.trim() || content.trim();
    return {
      status,
      content,
      nextRoundInstructions
    };
  }

  async evaluateDiscussion(
    discussionId: string,
    moderatorName?: string
  ): Promise<QualityGateResult> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const discussionsDir = path.join(this.dirPath, '.room', 'discussions');
    const logPath = path.join(discussionsDir, `${discussionId}.json`);
    const markdownLogPath = path.join(discussionsDir, `${discussionId}.md`);
    const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
    const agents = await loadAgents(this.dirPath);
    const moderator = (
      moderatorName
        ? agents.find(agent => agent.name.toLowerCase() === moderatorName.toLowerCase())
        : undefined
    ) || agents.find(agent => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return text.includes('moderator') || text.includes('lead') || text.includes('director') || text.includes('reviewer');
    }) || agents[0];

    if (!moderator) {
      throw new Error('No AI member is available to run the quality gate.');
    }

    await this.assertAgentExecutionAllowed(moderator);
    const provider = this.getProvider(moderator);
    const transcript = renderDiscussionMarkdown(discussionLog);
    const prompt = `Evaluate whether this ROOM chat has answered the user's goal well enough to stop.

Do not add new creative or implementation work unless it is needed to explain a gap.
Be strict about vagueness, contradictions, missing decisions, weak next steps, or agents ignoring each other.

Return exactly these sections:
STATUS: PASS | NEEDS_MORE_DISCUSSION
SUMMARY:
GAPS:
NEXT_ROUND_INSTRUCTIONS:

Rules:
- Use PASS only when the chat is coherent, useful, and has enough concrete output for the user's request.
- Use NEEDS_MORE_DISCUSSION when another focused round would materially improve the result.
- If NEEDS_MORE_DISCUSSION, NEXT_ROUND_INSTRUCTIONS must tell the next agents exactly what to fix or deepen.
- Keep the same natural language as the chat unless the user explicitly asked otherwise.

Chat transcript:
${transcript}`;

    const systemPrompt = `${moderator.systemPrompt}

${LANGUAGE_POLICY}

You are the ROOM quality gate. Your job is to decide whether the current chat is good enough or needs one more focused discussion round.`;

    const content = await provider.execute(prompt, systemPrompt);
    const result = this.parseQualityGateResult(content);
    const contextMessages = discussionLog.messages.map(message => ({
      type: message.type || 'agent',
      agentName: message.agentName,
      providerName: message.providerName,
      timestamp: message.timestamp
    }));

    discussionLog.messages.push({
      type: 'agent',
      agentName: moderator.name,
      providerName: moderator.provider,
      content,
      timestamp: new Date().toLocaleTimeString(),
      contextMessages
    });
    discussionLog.status = result.status === 'PASS' ? 'approved' : 'needs_revision';

    await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
    await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');

    return result;
  }

  async summarizeDiscussion(
    discussionId: string,
    agentNames: string[] = [],
    summaryAgentOverride?: AgentConfig
  ): Promise<{ filename: string; content: string }> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const logPath = path.join(this.dirPath, '.room', 'discussions', `${discussionId}.json`);
    const discussionLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
    const agents = await loadAgents(this.dirPath);
    const summaryAgent = summaryAgentOverride || agentNames
      .map(name => agents.find(a => a.name.toLowerCase() === name.toLowerCase()))
      .find((agent): agent is AgentConfig => !!agent) || agents.find(agent => {
        const text = `${agent.name} ${agent.role}`.toLowerCase();
        return text.includes('reporter') || text.includes('scribe') || text.includes('summary');
      }) || agents[0];

    if (!summaryAgent) {
      throw new Error('No AI member is available to summarize this chat.');
    }

    await this.assertAgentExecutionAllowed(summaryAgent);
    const provider = this.getProvider(summaryAgent);
    const transcript = renderDiscussionMarkdown(discussionLog);
    const prompt = `Summarize this ROOM chat into a durable workspace memory document.

Focus on the useful state that should survive after the raw chat becomes too long.
Do not merely restate every message.
Preserve important disagreements, decisions, open questions, options, and next steps.

Output clean Markdown with these sections:
- Summary
- Key Ideas
- Decisions
- Open Questions
- Options Discussed
- Next Steps
- Useful Context for Future Chats

Chat transcript:
${transcript}`;

    const systemPrompt = `${summaryAgent.systemPrompt}

${LANGUAGE_POLICY}

You are summarizing a collaborative ROOM chat into a compact memory artifact. Use the same natural language as the chat unless the user explicitly asked otherwise.`;

    const summary = await provider.execute(prompt, systemPrompt);
    const titleSource = discussionLog.topic || discussionLog.title || discussionId;
    const filename = `${this.safeDocumentSlug(titleSource)}-${discussionId}-summary.md`;
    const content = summary.trim().startsWith('#')
      ? summary.trim()
      : `# Chat Summary: ${titleSource}\n\n${summary.trim()}`;
    const documentsDir = path.join(this.dirPath, '.room', 'documents');
    await fs.mkdir(documentsDir, { recursive: true });
    await fs.writeFile(path.join(documentsDir, filename), `${content}\n`, 'utf-8');

    return { filename, content };
  }

  async runDiscussion(
    discussionId: string,
    title: string,
    topic: string,
    agentNames: string[] = [],
    maxRounds = 3,
    options: DiscussionRunOptions = {}
  ): Promise<DiscussionLog> {
    if (!/^discussion-\d+$/.test(discussionId)) {
      throw new Error('Invalid discussion id.');
    }

    const agents = await loadAgents(this.dirPath);
    const workflowAgents = agentNames
      .map(name => agents.find(a => a.name.toLowerCase() === name.toLowerCase()))
      .filter((a): a is AgentConfig => !!a);

    if (workflowAgents.length === 0) {
      throw new Error(`None of the requested AI members (${agentNames.join(', ') || 'none'}) were found in the workspace.`);
    }

    const discussionsDir = path.join(this.dirPath, '.room', 'discussions');
    await fs.mkdir(discussionsDir, { recursive: true });
    const logPath = path.join(discussionsDir, `${discussionId}.json`);
    const markdownLogPath = path.join(discussionsDir, `${discussionId}.md`);
    let discussionLog: DiscussionLog;
    try {
      const existingLog = JSON.parse(await fs.readFile(logPath, 'utf-8')) as DiscussionLog;
      discussionLog = {
        id: discussionId,
        title: existingLog.title || title,
        topic,
        status: 'active',
        messages: Array.isArray(existingLog.messages) ? existingLog.messages : []
      };
    } catch {
      discussionLog = {
        id: discussionId,
        title: title,
        topic,
        status: 'active',
        messages: []
      };
    }
    options.onEvent?.({
      type: 'discussion_started',
      discussionId,
      title: discussionLog.title
    });

    let projectContext = '';
    const overview = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'overview.md'),
      path.join(this.dirPath, '.room', 'workspace.md'),
      path.join(this.dirPath, '.room', 'project.md')
    ]);
    const structure = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'structure.md'),
      path.join(this.dirPath, '.room', 'architecture', 'current.md')
    ]);
    projectContext = overview;
    if (structure) {
      projectContext += `\n\nWorkspace Structure:\n${structure}`;
    }
    if (options.additionalContext?.trim()) {
      projectContext += `\n\nSelected Context:\n${options.additionalContext.trim()}`;
    }

    const userMessage: DiscussionMessage = {
      type: 'user',
      agentName: options.userLabel || 'You',
      providerName: 'User',
      content: topic,
      timestamp: new Date().toLocaleTimeString()
    };
    discussionLog.messages.push(userMessage);

    let conversationHistory = discussionLog.messages.map(message => {
      if (message.type === 'user') {
        return `--- ${message.agentName} ---\n${message.content}`;
      }
      return `--- ${message.agentName} (${message.providerName}) ---\n${message.content}`;
    }).join('\n\n');
    conversationHistory += '\n\n';
    let approved = false;
    let successfulAgentRuns = 0;
    let failedAgentRuns = 0;
    const reviewerAgents = options.reviewMode
      ? workflowAgents.filter(agent => this.isReviewerAgent(agent))
      : [];

    for (let round = 1; round <= maxRounds; round++) {
      const roundReviewerApprovals = new Map<string, boolean>();

      for (const agent of workflowAgents) {
        console.log(`[Discussion Engine] Running Agent: ${agent.name} (Round ${round})...`);
        await this.assertAgentExecutionAllowed(agent);
        const provider = this.getProvider(agent);
        options.onEvent?.({
          type: 'agent_started',
          discussionId,
          agentName: agent.name,
          providerName: agent.provider,
          role: agent.role,
          round,
          timestamp: new Date().toLocaleTimeString()
        });
        let skillsContext = '';
        if (agent.skills && agent.skills.length > 0) {
          skillsContext = '\n\n=== Active Skills ===\n';
          for (const skillFile of agent.skills) {
            try {
              const resolvedSkillPath = await this.resolveSkillPath(skillFile);
              const skillContent = await fs.readFile(resolvedSkillPath, 'utf-8');
              skillsContext += `\n[Skill: ${skillFile}]\n${skillContent}\n`;
            } catch (err: any) {
              console.error(`Error loading skill ${skillFile}:`, err.message);
            }
          }
        }

        const contextMessages = discussionLog.messages.map(message => ({
          type: message.type || 'agent',
          agentName: message.agentName,
          providerName: message.providerName,
          timestamp: message.timestamp
        }));
        const priorMessageInstruction = contextMessages.length > 0
          ? `\n\nYou have ${contextMessages.length} previous chat message(s) in the discussion history, including the user's latest message. Explicitly build on, refine, challenge, or resolve points from that history instead of answering as a standalone first response.`
          : '\n\nYou are the first AI member to respond. Establish a useful starting point for the later members.';
        const reviewProtocol = options.reviewMode ? this.buildReviewProtocol(agent) : '';
        const systemPrompt = `${agent.systemPrompt}\n\n${LANGUAGE_POLICY}\n\n${DISCUSSION_PROTOCOL}${skillsContext}${reviewProtocol}\n\n=== Project Context ===\n${projectContext}`;
        const prompt = `Here is the discussion history so far:\n${conversationHistory}\n\nPlease provide your response as the ${agent.name} (${agent.role}).${priorMessageInstruction}${options.reviewMode ? '\n\nIf this is a later round, focus on closing remaining OPEN_FINDINGS before introducing new recommendations.' : ''}`;

        let response = '';
        let agentFailed = false;
        try {
          response = await provider.execute(prompt, systemPrompt, {
            onChunk: (chunk) => {
              options.onEvent?.({
                type: 'agent_chunk',
                discussionId,
                agentName: agent.name,
                providerName: agent.provider,
                round,
                chunk
              });
            }
          });
          successfulAgentRuns++;
        } catch (err: any) {
          agentFailed = true;
          failedAgentRuns++;
          console.error(`Error executing agent ${agent.name}:`, err.message);
          options.onEvent?.({
            type: 'agent_error',
            discussionId,
            agentName: agent.name,
            providerName: agent.provider,
            round,
            error: err.message
          });
          response = `[System Error from ${agent.name}]: Failed to execute provider ${agent.provider}. Details: ${err.message}`;
        }

        const msg: DiscussionMessage = {
          type: 'agent',
          agentName: agent.name,
          providerName: agent.provider,
          content: response,
          timestamp: new Date().toLocaleTimeString(),
          contextMessages
        };

        discussionLog.messages.push(msg);
        options.onEvent?.({
          type: 'message_completed',
          discussionId,
          message: msg,
          round
        });
        conversationHistory += `\n--- ${agent.name} (${agent.role}) ---\n${response}\n`;

        await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
        await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');

        if (options.reviewMode && this.isReviewerAgent(agent)) {
          roundReviewerApprovals.set(agent.name, !agentFailed && this.isExplicitlyApproved(response));
        }
      }

      if (reviewerAgents.length > 0 && reviewerAgents.every(agent => roundReviewerApprovals.get(agent.name) === true)) {
        approved = true;
        console.log('[Discussion Engine] All reviewer agents approved the design. Workflow finished.');
        break;
      }
    }

    if (options.reviewMode) {
      discussionLog.status = successfulAgentRuns === 0 && failedAgentRuns > 0
        ? 'blocked'
        : (approved ? 'approved' : 'needs_revision');
    } else {
      discussionLog.status = successfulAgentRuns === 0 && failedAgentRuns > 0 ? 'blocked' : 'completed';
    }
    await fs.writeFile(logPath, JSON.stringify(discussionLog, null, 2), 'utf-8');
    await fs.writeFile(markdownLogPath, renderDiscussionMarkdown(discussionLog), 'utf-8');
    options.onEvent?.({
      type: 'discussion_completed',
      discussionId,
      log: discussionLog
    });
    return discussionLog;
  }

  async runCodingTask(
    taskId: string,
    title: string,
    task: string,
    developerName: string,
    reviewerNames: string[] = [],
    maxCycles = 2,
    options: CodingTaskRunOptions = {}
  ): Promise<CodingTaskResult> {
    if (!/^task-\d+$/.test(taskId)) {
      throw new Error('Invalid task id.');
    }

    const agents = await loadAgents(this.dirPath);
    const developer = agents.find(agent => agent.name.toLowerCase() === developerName.toLowerCase())
      || agents.find(agent => this.isDeveloperAgent(agent));
    if (!developer) {
      throw new Error('No Doer AI member is available for this task.');
    }

    const reviewers = reviewerNames
      .map(name => agents.find(agent => agent.name.toLowerCase() === name.toLowerCase()))
      .filter((agent): agent is AgentConfig => !!agent);
    const fallbackReviewer = agents.find(agent => this.isReviewerAgent(agent));
    if (reviewers.length === 0 && fallbackReviewer) {
      reviewers.push(fallbackReviewer);
    }
    if (reviewers.length === 0) {
      throw new Error('No Reviewer or Lead AI member is available for this task.');
    }

    const tasksDir = path.join(this.dirPath, '.room', 'tasks');
    const documentsDir = path.join(this.dirPath, '.room', 'documents');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(documentsDir, { recursive: true });
    const jsonFilename = `${taskId}.json`;
    const markdownFilename = `${taskId}.md`;
    const artifactFilename = `${taskId}-artifact.md`;
    const jsonPath = path.join(tasksDir, jsonFilename);
    const markdownPath = path.join(tasksDir, markdownFilename);
    const artifactPath = path.join(documentsDir, artifactFilename);

    const taskType = (options.taskType || 'general').trim().toLowerCase();
    const isCodingTask = taskType === 'coding';
    const doerLabel = isCodingTask ? 'Developer' : 'Doer';
    const reviewerLabel = isCodingTask ? 'Senior Developer or Reviewer' : 'Reviewer or Lead';
    const doerWorkInstructions = isCodingTask
      ? `- Work only inside the workspace root shown above.
- If your provider can edit files or run commands, implement the requested change now.
- If you cannot edit files directly, provide an exact patch-level implementation plan and say clearly that no files were changed.
- After working, report changed files, important decisions, validation commands run, and anything still blocked.`
      : `- Produce the requested work artifact now, not only a plan.
- Use the workspace context and selected references as source material.
- If the work should become a document, scene, research memo, decision note, checklist, or production plan, write it in clean Markdown.
- After working, report the artifact produced, decisions made, sources or context used, and anything still blocked.`;
    const reviewerRules = isCodingTask
      ? `- If your provider can inspect files or run commands, inspect the actual workspace before approving.
- Prioritize correctness, regressions, missing tests, unsafe filesystem behavior, and whether the task was actually implemented.
- If changes are needed, make them concrete enough for the Developer to fix in the next cycle.`
      : `- Review the actual artifact or deliverable, not just the intent.
- Prioritize usefulness, correctness, coherence, missing context, audience fit, and whether the task goal was actually satisfied.
- If changes are needed, make them concrete enough for the Doer to fix in the next cycle.`;

    let projectContext = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'overview.md'),
      path.join(this.dirPath, '.room', 'workspace.md'),
      path.join(this.dirPath, '.room', 'project.md')
    ]);
    const structure = await this.readFirstExistingFile([
      path.join(this.dirPath, '.room', 'context', 'structure.md'),
      path.join(this.dirPath, '.room', 'architecture', 'current.md')
    ]);
    if (structure) {
      projectContext += `\n\nWorkspace Structure:\n${structure}`;
    }
    if (options.additionalContext?.trim()) {
      projectContext += `\n\nSelected Context:\n${options.additionalContext.trim()}`;
    }

    const result: CodingTaskResult = {
      id: taskId,
      title,
      task,
      taskType,
      status: 'needs_revision',
      cycles: 0,
      messages: [{
        type: 'user',
        agentName: 'You',
        providerName: 'User',
        content: task,
        timestamp: new Date().toLocaleTimeString()
      }],
      markdownFilename,
      jsonFilename,
      artifactFilename,
      statusSummary: 'Task is queued.'
    };

    const saveResult = async () => {
      await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
      await fs.writeFile(markdownPath, renderCodingTaskMarkdown(result), 'utf-8');
    };

    options.onEvent?.({ type: 'discussion_started', discussionId: taskId, title });
    await saveResult();

    let reviewerFeedback = '';
    const cycleLimit = Math.max(1, Math.min(5, Math.floor(maxCycles || 1)));
    for (let cycle = 1; cycle <= cycleLimit; cycle++) {
      result.cycles = cycle;
      await this.assertAgentExecutionAllowed(developer);
      const developerProvider = this.getProvider(developer);
      options.onEvent?.({
        type: 'agent_started',
        discussionId: taskId,
        agentName: developer.name,
        providerName: developer.provider,
        role: developer.role,
        round: cycle,
        timestamp: new Date().toLocaleTimeString()
      });

      const developerPrompt = `You are the ${doerLabel} assigned to this ROOM task.

Task type:
${taskType}

Task:
${task}

Workspace root:
${this.dirPath}

Project context:
${projectContext || '(No workspace context provided.)'}

Reviewer feedback to address:
${reviewerFeedback || '(No reviewer feedback yet.)'}

Instructions:
${doerWorkInstructions}
- Use the same natural language as the user's task unless the user explicitly asks otherwise.`;

      const developerSystemPrompt = `${developer.systemPrompt}

${LANGUAGE_POLICY}

You are in a ROOM task execution loop. Your responsibility is to produce the requested deliverable, then address reviewer feedback until it is approved.`;

      let developerOutput = '';
      try {
        developerOutput = await developerProvider.execute(developerPrompt, developerSystemPrompt, {
          onChunk: (chunk) => {
            options.onEvent?.({
              type: 'agent_chunk',
              discussionId: taskId,
              agentName: developer.name,
              providerName: developer.provider,
              round: cycle,
              chunk
            });
          }
        });
      } catch (err: any) {
        options.onEvent?.({
          type: 'agent_error',
          discussionId: taskId,
          agentName: developer.name,
          providerName: developer.provider,
          round: cycle,
          error: err.message
        });
        developerOutput = `[System Error from ${developer.name}]: ${err.message}`;
      }

      const contextMessages = result.messages.map(message => ({
        type: message.type || 'agent',
        agentName: message.agentName,
        providerName: message.providerName,
        timestamp: message.timestamp
      }));
      const developerMessage: DiscussionMessage = {
        type: 'agent',
        agentName: developer.name,
        providerName: developer.provider,
        content: developerOutput,
        timestamp: new Date().toLocaleTimeString(),
        contextMessages
      };
      result.messages.push(developerMessage);
      result.statusSummary = `${doerLabel} completed cycle ${cycle}. Waiting for review.`;
      options.onEvent?.({ type: 'message_completed', discussionId: taskId, message: developerMessage, round: cycle });
      await saveResult();

      const reviewerOutputs: string[] = [];
      for (const reviewer of reviewers) {
        await this.assertAgentExecutionAllowed(reviewer);
        const reviewerProvider = this.getProvider(reviewer);
        options.onEvent?.({
          type: 'agent_started',
          discussionId: taskId,
          agentName: reviewer.name,
          providerName: reviewer.provider,
          role: reviewer.role,
          round: cycle,
          timestamp: new Date().toLocaleTimeString()
        });

        const reviewPrompt = `Review this ROOM task after the ${doerLabel}'s latest pass.

Task type:
${taskType}

Task:
${task}

Workspace root:
${this.dirPath}

Project context:
${projectContext || '(No workspace context provided.)'}

${doerLabel} report:
${developerOutput}

Review rules:
${reviewerRules}
- Use APPROVAL_STATUS: APPROVED only when the task appears complete and no meaningful required change remains.
- Otherwise use APPROVAL_STATUS: NEEDS_CHANGES.

Output format:
- REVIEW_SUMMARY
- OPEN_FINDINGS
- REQUIRED_CHANGES
- VALIDATION_NOTES
- APPROVAL_STATUS: APPROVED | NEEDS_CHANGES`;

        const reviewerSystemPrompt = `${reviewer.systemPrompt}

${LANGUAGE_POLICY}

You are the ${reviewerLabel} in a ROOM task loop. Be strict, specific, and do not approve incomplete work.`;

        let reviewOutput = '';
        try {
          reviewOutput = await reviewerProvider.execute(reviewPrompt, reviewerSystemPrompt, {
            onChunk: (chunk) => {
              options.onEvent?.({
                type: 'agent_chunk',
                discussionId: taskId,
                agentName: reviewer.name,
                providerName: reviewer.provider,
                round: cycle,
                chunk
              });
            }
          });
        } catch (err: any) {
          options.onEvent?.({
            type: 'agent_error',
            discussionId: taskId,
            agentName: reviewer.name,
            providerName: reviewer.provider,
            round: cycle,
            error: err.message
          });
          reviewOutput = `[System Error from ${reviewer.name}]: ${err.message}`;
        }

        reviewerOutputs.push(reviewOutput);
        const reviewerContextMessages = result.messages.map(message => ({
          type: message.type || 'agent',
          agentName: message.agentName,
          providerName: message.providerName,
          timestamp: message.timestamp
        }));
        const reviewerMessage: DiscussionMessage = {
          type: 'agent',
          agentName: reviewer.name,
          providerName: reviewer.provider,
          content: reviewOutput,
          timestamp: new Date().toLocaleTimeString(),
          contextMessages: reviewerContextMessages
        };
        result.messages.push(reviewerMessage);
        options.onEvent?.({ type: 'message_completed', discussionId: taskId, message: reviewerMessage, round: cycle });
        await saveResult();
      }

      if (this.parseCodingApproval(reviewerOutputs)) {
        result.status = 'approved';
        result.approvedBy = reviewers.map(reviewer => reviewer.name);
        result.statusSummary = `Approved after ${cycle} cycle(s).\n${this.extractTaskReviewSummary(reviewerOutputs)}`;
        await saveResult();
        break;
      }

      reviewerFeedback = reviewerOutputs.join('\n\n---\n\n');
      result.statusSummary = `Needs revision after cycle ${cycle}.\n${this.extractTaskReviewSummary(reviewerOutputs)}`;
    }

    if (result.status !== 'approved' && result.cycles >= cycleLimit) {
      result.status = 'needs_revision';
      if (!result.statusSummary || result.statusSummary === 'Task is queued.') {
        result.statusSummary = `Stopped after ${result.cycles} cycle(s) without approval.`;
      }
    }

    const finalDoerMessage = [...result.messages]
      .reverse()
      .find(message => message.type === 'agent' && message.agentName === developer.name) || null;
    await fs.writeFile(artifactPath, renderTaskArtifact(result, finalDoerMessage), 'utf-8');
    await saveResult();
    options.onEvent?.({
      type: 'discussion_completed',
      discussionId: taskId,
      log: {
        id: taskId,
        title,
        topic: task,
        status: result.status,
        messages: result.messages
      }
    });
    return result;
  }
}
