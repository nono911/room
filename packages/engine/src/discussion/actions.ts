export interface ContinueAction {
  action: 'continue';
  instructions?: string;
}

export interface StopAction {
  action: 'stop';
  reason?: string;
}

export interface CreateTaskAction {
  action: 'create_task';
  title: string;
  details?: string;
  kind?: 'epic' | 'task' | 'subtask';
  parent?: string;
}

export interface CreateAdrAction {
  action: 'create_adr';
  title: string;
  context?: string;
  decision?: string;
}

export type ModeratorAction = ContinueAction | StopAction | CreateTaskAction | CreateAdrAction;

export interface ParsedModeratorActions {
  actions: ModeratorAction[];
  errors: string[];
}

const ACTION_BLOCK_PATTERN = /```room-action\s*\n([\s\S]*?)```/g;

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateAction(candidate: any): ModeratorAction | string {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.action !== 'string') {
    return 'room-action block is missing a string "action" field.';
  }
  switch (candidate.action) {
    case 'continue':
      return { action: 'continue', instructions: asOptionalString(candidate.instructions) };
    case 'stop':
      return { action: 'stop', reason: asOptionalString(candidate.reason) };
    case 'create_task': {
      const title = asOptionalString(candidate.title);
      if (!title) return 'create_task action requires a non-empty "title".';
      const kind = candidate.kind === 'epic' || candidate.kind === 'task' || candidate.kind === 'subtask'
        ? candidate.kind
        : 'task';
      return {
        action: 'create_task',
        title,
        details: asOptionalString(candidate.details),
        kind,
        parent: asOptionalString(candidate.parent)
      };
    }
    case 'create_adr': {
      const title = asOptionalString(candidate.title);
      if (!title) return 'create_adr action requires a non-empty "title".';
      return {
        action: 'create_adr',
        title,
        context: asOptionalString(candidate.context),
        decision: asOptionalString(candidate.decision)
      };
    }
    default:
      return `Unknown room-action "${candidate.action}".`;
  }
}

export function parseModeratorActions(content: string): ParsedModeratorActions {
  const actions: ModeratorAction[] = [];
  const errors: string[] = [];
  for (const match of content.matchAll(ACTION_BLOCK_PATTERN)) {
    const raw = match[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      errors.push(`Invalid JSON in room-action block: ${err.message}`);
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const validated = validateAction(candidate);
      if (typeof validated === 'string') {
        errors.push(validated);
      } else {
        actions.push(validated);
      }
    }
  }
  return { actions, errors };
}

export function stripActionBlocks(content: string): string {
  return content.replace(ACTION_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
}
