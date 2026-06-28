import { ModeratorAction, CreateTaskAction } from './actions.js';
import { addTaskCards, TaskCard } from './taskBoard.js';
import { createNewADR } from '../decisions/adr.js';

export interface ActionExecutionResult {
  control: 'continue' | 'stop' | null;
  controlInstructions?: string;
  createdTaskCards: TaskCard[];
  createdAdrs: { id: string; filename: string }[];
  errors: string[];
}

export async function executeModeratorActions(
  dirPath: string,
  actions: ModeratorAction[],
  sourceDiscussionId?: string
): Promise<ActionExecutionResult> {
  const result: ActionExecutionResult = {
    control: null,
    createdTaskCards: [],
    createdAdrs: [],
    errors: []
  };

  for (const action of actions) {
    if (action.action === 'continue') {
      result.control = 'continue';
      result.controlInstructions = action.instructions;
    } else if (action.action === 'stop') {
      result.control = 'stop';
      result.controlInstructions = action.reason;
    }
  }

  const taskActions = actions.filter((action): action is CreateTaskAction => action.action === 'create_task');
  if (taskActions.length > 0) {
    try {
      result.createdTaskCards = await addTaskCards(
        dirPath,
        taskActions.map(action => ({
          title: action.title,
          kind: action.kind,
          parent: action.parent,
          details: action.details,
          assignee: action.assignee
        })),
        sourceDiscussionId
      );
    } catch (err: any) {
      result.errors.push(`create_task failed: ${err.message}`);
    }
  }

  for (const action of actions) {
    if (action.action !== 'create_adr') continue;
    try {
      const { id, filename, created } = await createNewADR(dirPath, action.title, { context: action.context, decision: action.decision });
      if (created) {
        result.createdAdrs.push({ id, filename });
      }
    } catch (err: any) {
      result.errors.push(`create_adr "${action.title}" failed: ${err.message}`);
    }
  }

  return result;
}
