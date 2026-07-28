import { createHash } from 'crypto';
import * as path from 'path';
import { PromptHistoryMessage } from './contextCompiler.js';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';
import { readRoomTextFile, writeRoomTextFile } from '../roomFile.js';
import { isDiscussionRunId, isTaskRunId } from './runId.js';

export type ContextSummarySource = 'discussion' | 'coding-task';

export interface ContextSummaryCache {
  version: 1;
  source: ContextSummarySource;
  contextId: string;
  summarizedMessageIndexes: number[];
  summarizedMessageCount: number;
  summaryInputHash: string;
  summary: string;
  updatedAt: string;
}

export interface ContextSummaryCacheInput {
  workspace?: WorkspaceInput;
  dirPath?: WorkspaceInput;
  source: ContextSummarySource;
  contextId: string;
}

export function validateContextSummaryId(source: ContextSummarySource, contextId: string): void {
  const valid = source === 'discussion'
    ? isDiscussionRunId(contextId)
    : isTaskRunId(contextId);
  if (!valid) {
    throw new Error(`Invalid ${source} context summary id.`);
  }
}

export function contextSummaryCachePath(input: ContextSummaryCacheInput): string {
  validateContextSummaryId(input.source, input.contextId);
  const dirname = input.source === 'discussion' ? 'discussions' : 'tasks';
  const workspace = input.workspace ?? input.dirPath;
  if (!workspace) {
    throw new Error('Room location is required for context summary cache.');
  }
  return resolveRoomPath(workspace, dirname, `${input.contextId}.context-summary.json`);
}

export async function readContextSummaryCache(input: ContextSummaryCacheInput): Promise<ContextSummaryCache | null> {
  const cachePath = contextSummaryCachePath(input);
  try {
    const workspace = input.workspace ?? input.dirPath;
    if (!workspace) throw new Error('Room location is required for context summary cache.');
    const parsed = JSON.parse(await readRoomTextFile(
      workspace,
      [input.source === 'discussion' ? 'discussions' : 'tasks', path.basename(cachePath)],
      2 * 1024 * 1024
    )) as ContextSummaryCache;
    if (!isContextSummaryCache(parsed, input.source, input.contextId)) {
      return null;
    }
    return parsed;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    if (err instanceof SyntaxError) {
      return null;
    }
    throw err;
  }
}

export async function writeContextSummaryCache(
  input: ContextSummaryCacheInput,
  cache: ContextSummaryCache
): Promise<void> {
  const cachePath = contextSummaryCachePath(input);
  const workspace = input.workspace ?? input.dirPath;
  if (!workspace) throw new Error('Room location is required for context summary cache.');
  await writeRoomTextFile(
    workspace,
    [input.source === 'discussion' ? 'discussions' : 'tasks', path.basename(cachePath)],
    `${JSON.stringify(cache, null, 2)}\n`
  );
}

export function isReusableContextSummaryCache(
  cache: ContextSummaryCache | null,
  messages: PromptHistoryMessage[],
  candidateIndexes: number[]
): cache is ContextSummaryCache {
  if (!cache) {
    return false;
  }
  return sameOrderedIndexes(cache.summarizedMessageIndexes, candidateIndexes)
    && cache.summaryInputHash === hashSummaryInput(messages, candidateIndexes);
}

export interface ContextSummaryCacheReuse {
  exact: boolean;
  prefix: boolean;
  uncoveredIndexes: number[];
}

export function checkContextSummaryCacheReuse(
  cache: ContextSummaryCache | null,
  messages: PromptHistoryMessage[],
  candidateIndexes: number[]
): ContextSummaryCacheReuse {
  const noReuse: ContextSummaryCacheReuse = { exact: false, prefix: false, uncoveredIndexes: candidateIndexes };
  if (!cache || cache.summarizedMessageIndexes.length === 0) return noReuse;
  const covered = cache.summarizedMessageIndexes;
  if (covered.length > candidateIndexes.length) return noReuse;
  if (!covered.every((value, index) => value === candidateIndexes[index])) return noReuse;
  if (cache.summaryInputHash !== hashSummaryInput(messages, covered)) return noReuse;
  const uncoveredIndexes = candidateIndexes.slice(covered.length);
  return { exact: uncoveredIndexes.length === 0, prefix: true, uncoveredIndexes };
}

export function createContextSummaryCache(
  source: ContextSummarySource,
  contextId: string,
  messages: PromptHistoryMessage[],
  candidateIndexes: number[],
  summary: string
): ContextSummaryCache {
  validateContextSummaryId(source, contextId);
  return {
    version: 1,
    source,
    contextId,
    summarizedMessageIndexes: [...candidateIndexes],
    summarizedMessageCount: candidateIndexes.length,
    summaryInputHash: hashSummaryInput(messages, candidateIndexes),
    summary,
    updatedAt: new Date().toISOString()
  };
}

export function hashSummaryInput(messages: PromptHistoryMessage[], candidateIndexes: number[]): string {
  const payload = candidateIndexes.map(index => {
    const message = messages[index];
    return {
      index,
      id: message.id,
      type: message.type || 'agent',
      agentName: message.agentName,
      providerName: message.providerName,
      content: message.content
    };
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function sameOrderedIndexes(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function isContextSummaryCache(
  value: ContextSummaryCache,
  source: ContextSummarySource,
  contextId: string
): value is ContextSummaryCache {
  return value?.version === 1
    && value.source === source
    && value.contextId === contextId
    && Array.isArray(value.summarizedMessageIndexes)
    && value.summarizedMessageIndexes.every(index => Number.isInteger(index) && index >= 0)
    && value.summarizedMessageCount === value.summarizedMessageIndexes.length
    && typeof value.summaryInputHash === 'string'
    && typeof value.summary === 'string'
    && typeof value.updatedAt === 'string';
}
