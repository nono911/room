import * as path from 'path';
import * as fs from 'fs/promises';
import type { RoomSource } from '@room/engine';
import {
  parseTaskCanonical,
  parseTaskCanonicalHeader,
  renderCodingTaskMarkdown,
  renderDiscussionMarkdown
} from '@room/engine';
import {
  CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES,
  CONTEXT_SEARCH_RESULT_LIMIT,
  CONTEXT_SEARCH_SCAN_LIMIT,
  WORKSPACE_FILE_READ_LIMIT_BYTES,
  extractMarkdownHeading,
  formatBytes,
  openVerifiedFileWithinProject,
  resolveRoomDataRoot,
  resolveWithinRoomData,
  type ContextSearchResult
} from './shared.js';
import {
  searchPinnedSourceContext
} from './pinned-context-search.js';
import { withContextSearchAdmission } from './context-search-admission.js';

interface ScoredResult extends ContextSearchResult {
  score: number;
}

function roomContextType(section: string): ContextSearchResult['type'] {
  if (section === 'tasks') return 'task';
  if (section === 'discussions') return 'discussion';
  return 'doc';
}

const CONTEXT_SEARCH_TOTAL_PREVIEW_BYTES = 4 * 1024 * 1024;

interface RoomSearchBudget {
  inspectedEntries: number;
  previewBytes: number;
}

function scoreCandidate(
  relativePath: string,
  query: string,
  modifiedAtMs: number,
  preview = ''
): number {
  const normalized = relativePath.toLowerCase();
  const queryParts = query.split(/\s+/).filter(Boolean);
  const normalizedPreview = preview.toLowerCase();
  if (
    queryParts.length > 0
    && !queryParts.every(part => normalized.includes(part) || normalizedPreview.includes(part))
  ) return -1;
  let score = normalized.startsWith('docs/') ? 180 : 50;
  if (/\b(todo|roadmap|plan|spec|requirement|issue|bug|feature|ticket|notes?)\b/.test(normalized)) {
    score += 80;
  }
  if (/\.(md|mdx|txt)$/i.test(normalized)) score += 45;
  if (queryParts.length > 0) {
    score += queryParts.every(part => normalized.includes(part)) ? 220 : 120;
  }
  const ageHours = Math.max(0, (Date.now() - modifiedAtMs) / 36e5);
  return score + Math.max(0, 60 - Math.min(60, ageHours / 12));
}

function labelFor(type: ContextSearchResult['type'], relativePath: string, heading?: string): string {
  const prefix = type === 'task' ? 'Task' : type === 'discussion' ? 'Chat' : type === 'doc' ? 'Doc' : 'File';
  return `${prefix}: ${heading || relativePath}`;
}

async function collectRoomResults(
  roomId: string,
  query: string,
  results: ScoredResult[],
  budget: RoomSearchBudget
): Promise<void> {
  const roomRoot = resolveRoomDataRoot(roomId);
  for (const section of ['tasks', 'documents', 'reviews', 'decisions', 'discussions'] as const) {
    if (budget.inspectedEntries >= CONTEXT_SEARCH_SCAN_LIMIT) return;
    const directory = resolveWithinRoomData(roomId, section);
    const entries = await fs.opendir(directory).catch(() => null);
    if (!entries) continue;
    for await (const entry of entries) {
      budget.inspectedEntries += 1;
      if (budget.inspectedEntries > CONTEXT_SEARCH_SCAN_LIMIT) return;
      const canonicalTask = section === 'tasks' && /^task-[\w-]+\.json$/i.test(entry.name);
      const canonicalDiscussion = section === 'discussions'
        && /^discussion-[\w-]+\.json$/i.test(entry.name);
      if (
        !entry.isFile()
        || (
          !entry.name.toLowerCase().endsWith('.md')
          && !canonicalTask
          && !canonicalDiscussion
        )
      ) continue;
      const visibleName = canonicalTask || canonicalDiscussion
        ? entry.name.replace(/\.json$/i, '.md')
        : entry.name;
      const relativePath = path.join(section, entry.name);
      const verified = await openVerifiedFileWithinProject(roomRoot, relativePath).catch(() => null);
      if (!verified) continue;
      const { handle, stat } = verified;
      try {
        if (stat.size > WORKSPACE_FILE_READ_LIMIT_BYTES) continue;
        const previewLength = Math.min(
          stat.size,
          CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES,
          Math.max(0, CONTEXT_SEARCH_TOTAL_PREVIEW_BYTES - budget.previewBytes)
        );
        const buffer = Buffer.alloc(previewLength);
        const bytesRead = previewLength > 0
          ? (await handle.read(buffer, 0, previewLength, 0)).bytesRead
          : 0;
        budget.previewBytes += bytesRead;
        const previewBuffer = buffer.subarray(0, bytesRead);
        let preview = previewBuffer.includes(0) ? '' : previewBuffer.toString('utf-8');
        let heading: string | undefined;
        try {
          if (canonicalTask) {
            heading = parseTaskCanonicalHeader(preview).title;
            if (bytesRead === stat.size) {
              preview = renderCodingTaskMarkdown(parseTaskCanonical(preview));
            }
          } else if (canonicalDiscussion && bytesRead === stat.size) {
            const discussion = JSON.parse(preview);
            heading = typeof discussion.title === 'string' ? discussion.title : undefined;
            preview = renderDiscussionMarkdown(discussion);
          }
        } catch {
          continue;
        }
        const baseScore = scoreCandidate(
          `.room/${relativePath}`,
          query,
          stat.mtimeMs,
          preview
        );
        if (baseScore < 0) continue;
        const score = baseScore
          + (section === 'tasks' ? 180 : section === 'documents' ? 145 : 100);
        const type = roomContextType(section);
        const prefix = section === 'tasks'
          ? 'task'
          : section === 'discussions'
            ? 'discussion'
            : 'document';
        results.push({
          ref: `${prefix}:${visibleName}`,
          label: labelFor(type, visibleName, heading || extractMarkdownHeading(preview)),
          type,
          path: `.room/${path.join(section, visibleName).split(path.sep).join('/')}`,
          detail: `${formatBytes(stat.size)} · modified ${stat.mtime.toISOString().slice(0, 10)}`,
          modifiedAt: stat.mtime.toISOString(),
          size: stat.size,
          score
        });
      } finally {
        await handle.close();
      }
    }
  }
}

async function collectSourceResults(
  source: RoomSource,
  query: string,
  results: ScoredResult[]
): Promise<void> {
  const files = await searchPinnedSourceContext(
    source,
    CONTEXT_SEARCH_SCAN_LIMIT,
    CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES,
    CONTEXT_SEARCH_TOTAL_PREVIEW_BYTES,
    WORKSPACE_FILE_READ_LIMIT_BYTES
  );
  for (const file of files) {
    const preview = file.preview.includes('\0') ? '' : file.preview;
    const score = scoreCandidate(
      file.path,
      query,
      Date.parse(file.modifiedAt),
      preview
    );
    const likelyContext = query
      || file.path.startsWith('docs/')
      || !file.path.includes('/')
      || /\.(md|mdx|txt)$/i.test(file.path);
    if (!likelyContext || score < 0 || file.size > WORKSPACE_FILE_READ_LIMIT_BYTES) continue;
    results.push({
      ref: `source-file:${source.id}:${encodeURIComponent(file.path)}`,
      label: labelFor('file', file.path, extractMarkdownHeading(preview)),
      type: 'file',
      path: file.path,
      detail: `${formatBytes(file.size)} · modified ${file.modifiedAt.slice(0, 10)}`,
      modifiedAt: file.modifiedAt,
      size: file.size,
      score
    });
  }
}

async function searchContextItemsInternal(
  roomId: string,
  source: RoomSource | undefined,
  query = ''
): Promise<ContextSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const results: ScoredResult[] = [];
  const defaults: ScoredResult[] = [{
      ref: 'workspace:overview',
      label: 'Room Overview',
      type: 'workspace',
      detail: 'ROOM Home · context/overview.md',
      score: normalizedQuery ? ('room overview'.includes(normalizedQuery) ? 500 : -1) : 500
    },
    {
      ref: 'workspace:structure',
      label: 'Room Structure',
      type: 'workspace',
      detail: 'ROOM Home · context/structure.md',
      score: normalizedQuery ? ('room structure architecture'.includes(normalizedQuery) ? 490 : -1) : 490
    }
  ];
  results.push(...defaults.filter(result => result.score >= 0));
  await collectRoomResults(roomId, normalizedQuery, results, {
    inspectedEntries: 0,
    previewBytes: 0
  });
  if (source) await collectSourceResults(source, normalizedQuery, results);
  const byRef = new Map<string, ScoredResult>();
  for (const result of results) {
    const existing = byRef.get(result.ref);
    if (!existing || result.score > existing.score) byRef.set(result.ref, result);
  }
  return [...byRef.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, CONTEXT_SEARCH_RESULT_LIMIT)
    .map(({ score: _score, ...result }) => result);
}

export async function searchContextItems(
  roomId: string,
  source: RoomSource | undefined,
  query = ''
): Promise<ContextSearchResult[]> {
  return withContextSearchAdmission(
    roomId,
    () => searchContextItemsInternal(roomId, source, query)
  );
}
