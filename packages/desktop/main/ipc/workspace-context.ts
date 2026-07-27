import * as path from 'path';
import * as fs from 'fs/promises';
import {
  CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES,
  CONTEXT_SEARCH_RESULT_LIMIT,
  CONTEXT_SEARCH_SCAN_LIMIT,
  IGNORED_WORKSPACE_DIRS,
  ROOM_DIR,
  WORKSPACE_FILE_READ_LIMIT_BYTES,
  extractMarkdownHeading,
  formatBytes,
  resolveCanonicalWithinProject,
  resolveProjectPath,
  resolveWithinProject,
  resolveRoomDataRoot,
  resolveWithinRoomData,
  type ContextSearchResult
} from './shared.js';

function isSearchableRoomContextFile(relPath: string): boolean {
  const normalized = relPath.toLowerCase();
  if (!normalized.startsWith(`${ROOM_DIR}/`)) return true;
  if (normalized.startsWith(`${ROOM_DIR}/tasks/`)) {
    const base = path.basename(normalized);
    if (base.startsWith('task-')) {
      return base.endsWith('-artifact.md');
    }
    return normalized.endsWith('.md');
  }
  if (normalized.startsWith(`${ROOM_DIR}/documents/`)) return normalized.endsWith('.md');
  if (normalized.startsWith(`${ROOM_DIR}/reviews/`)) return normalized.endsWith('.md');
  if (normalized.startsWith(`${ROOM_DIR}/decisions/`)) return normalized.endsWith('.md');
  if (normalized.startsWith(`${ROOM_DIR}/discussions/`)) return normalized.endsWith('.md');
  return false;
}

function getContextResultType(relPath: string): ContextSearchResult['type'] {
  const normalized = relPath.toLowerCase();
  if (normalized.startsWith(`${ROOM_DIR}/tasks/`)) return 'task';
  if (normalized.startsWith(`${ROOM_DIR}/discussions/`)) return 'discussion';
  if (
    normalized.startsWith(`${ROOM_DIR}/documents/`) ||
    normalized.startsWith(`${ROOM_DIR}/reviews/`) ||
    normalized.startsWith(`${ROOM_DIR}/decisions/`) ||
    normalized.startsWith('docs/') ||
    normalized.endsWith('/todo.md') ||
    normalized.endsWith('/roadmap.md') ||
    normalized.endsWith('/requirements.md') ||
    normalized.endsWith('/spec.md')
  ) {
    return 'doc';
  }
  return 'file';
}

function getContextRef(relPath: string): string {
  if (
    relPath.startsWith(`${ROOM_DIR}/documents/`) ||
    relPath.startsWith(`${ROOM_DIR}/reviews/`) ||
    relPath.startsWith(`${ROOM_DIR}/decisions/`) ||
    relPath.startsWith(`${ROOM_DIR}/discussions/`)
  ) {
    return `file:${relPath}`;
  }
  if (relPath.startsWith(`${ROOM_DIR}/tasks/`)) {
    return `task:${path.basename(relPath)}`;
  }
  return `file:${relPath}`;
}

function getContextLabel(type: ContextSearchResult['type'], relPath: string, heading?: string): string {
  if (type === 'workspace') return relPath;
  const prefix = type === 'task' ? 'Task' : type === 'doc' ? 'Doc' : type === 'discussion' ? 'Chat' : 'File';

  if (relPath.startsWith(`${ROOM_DIR}/documents/`) || relPath.startsWith(`${ROOM_DIR}/tasks/`)) {
    const base = path.basename(relPath);
    let topicName = base.replace(/\.md$/i, '');
    topicName = topicName.replace(/-discussion-\d+-summary$/i, '');
    topicName = topicName.replace(/-discussion-\d+-tasks$/i, '');
    topicName = topicName.replace(/[-_]+/g, ' ').trim();
    
    const suffix = base.toLowerCase().includes('-tasks') ? 'Tasks' : 'Summary';
    return `${prefix}: ${topicName} (${suffix})`;
  }

  if (heading) {
    return `${prefix}: ${heading}`;
  }
  return `${prefix}: ${relPath}`;
}

function scoreContextCandidate(relPath: string, query: string, modifiedAtMs: number): number {
  const normalized = relPath.toLowerCase();
  const queryParts = query.split(/\s+/).filter(Boolean);
  let score = 0;

  if (normalized.startsWith(`${ROOM_DIR}/tasks/`)) score += 180;
  if (normalized.startsWith(`${ROOM_DIR}/documents/`)) score += 145;
  if (normalized.startsWith(`${ROOM_DIR}/reviews/`) || normalized.startsWith(`${ROOM_DIR}/decisions/`)) score += 130;
  if (normalized.startsWith(`${ROOM_DIR}/discussions/`)) score += 90;
  if (normalized.startsWith('docs/')) score += 150;
  if (!normalized.includes('/')) score += 90;
  if (/\b(todo|roadmap|plan|spec|requirement|requirements|issue|bug|feature|implementation|ticket|backlog|notes?)\b/.test(normalized)) score += 80;
  if (normalized.endsWith('.md') || normalized.endsWith('.mdx') || normalized.endsWith('.txt')) score += 45;
  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx') || normalized.endsWith('.js') || normalized.endsWith('.jsx')) score += 25;

  if (queryParts.length > 0) {
    const basename = path.basename(normalized);
    const allMatch = queryParts.every(part => normalized.includes(part));
    if (!allMatch) return -1;
    score += 220;
    for (const part of queryParts) {
      if (basename.includes(part)) score += 80;
      if (normalized.startsWith(part)) score += 60;
    }
  }

  const ageHours = Math.max(0, (Date.now() - modifiedAtMs) / 36e5);
  score += Math.max(0, 60 - Math.min(60, ageHours / 12));
  return score;
}

async function readContextSearchPreview(filePath: string, size: number): Promise<string> {
  if (size > CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES) return '';
  const buffer = await fs.readFile(filePath).catch(() => Buffer.alloc(0));
  if (buffer.includes(0)) return '';
  return buffer.toString('utf-8');
}

export async function searchContextItems(
  roomId: string,
  sourceRoot: string | undefined,
  query = ''
): Promise<ContextSearchResult[]> {
  const root = sourceRoot ? resolveProjectPath(sourceRoot) : undefined;
  const roomRoot = resolveRoomDataRoot(roomId);
  const normalizedQuery = query.trim().toLowerCase();
  const results: Array<ContextSearchResult & { score: number }> = [
    {
      ref: 'workspace:overview',
      label: 'Room Overview',
      type: 'workspace' as const,
      detail: 'ROOM Home · context/overview.md',
      score: normalizedQuery ? ('room overview'.includes(normalizedQuery) ? 500 : -1) : 500
    },
    {
      ref: 'workspace:structure',
      label: 'Room Structure',
      type: 'workspace' as const,
      detail: 'ROOM Home · context/structure.md',
      score: normalizedQuery ? ('room structure architecture'.includes(normalizedQuery) ? 490 : -1) : 490
    }
  ].filter(result => result.score >= 0);
  let scanned = 0;

  async function addFileResult(fullPath: string, scoreOverride?: number, roomManaged = false) {
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || !stat.isFile()) return;
    if (stat.size > WORKSPACE_FILE_READ_LIMIT_BYTES) return;

    const relPath = roomManaged
      ? `${ROOM_DIR}/${path.relative(roomRoot, fullPath).split(path.sep).join('/')}`
      : path.relative(root || '', fullPath).split(path.sep).join('/');
    const normalized = relPath.toLowerCase();
    if (!isSearchableRoomContextFile(relPath)) return;

    const shouldReadPreview = /\.(md|mdx|txt)$/i.test(relPath) || normalized.startsWith('docs/') || normalized.startsWith(`${ROOM_DIR}/`);
    const preview = shouldReadPreview ? await readContextSearchPreview(fullPath, stat.size) : '';
    const previewSearch = preview.toLowerCase();
    const isLikelyContext =
      scoreOverride !== undefined ||
      normalizedQuery ||
      normalized.startsWith(`${ROOM_DIR}/`) ||
      normalized.startsWith('docs/') ||
      !normalized.includes('/') ||
      /\.(md|mdx|txt)$/i.test(relPath);
    if (!isLikelyContext) return;

    let score = scoreOverride ?? scoreContextCandidate(relPath, normalizedQuery, stat.mtimeMs);
    if (score < 0 && normalizedQuery && previewSearch) {
      const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);
      if (queryParts.every(part => previewSearch.includes(part))) {
        score = 210 + Math.max(0, 60 - Math.min(60, (Date.now() - stat.mtimeMs) / 36e5 / 12));
      }
    }
    if (score < 0) return;

    const type = getContextResultType(relPath);
    const heading = preview ? extractMarkdownHeading(preview) : undefined;
    let label = getContextLabel(type, relPath, heading);
    if (type === 'task') {
      const base = path.basename(relPath);
      if (base.startsWith('task-') && base.endsWith('-artifact.md')) {
        const jsonFile = base.replace(/-artifact\.md$/i, '.json');
        const jsonPath = resolveWithinRoomData(roomId, 'tasks', jsonFile);
        try {
          const jsonContent = await fs.readFile(jsonPath, 'utf-8');
          const meta = JSON.parse(jsonContent);
          const title = meta.title || meta.task || '';
          const cleanTitle = title.replace(/^Task:\s*/i, '').trim();
          const cardId = meta.associatedCardId ? `${meta.associatedCardId} — ` : '';
          const status = meta.status ? ` [${meta.status.toUpperCase().replace(/_/g, ' ')}]` : '';
          label = `Task: ${cardId}${cleanTitle}${status}`;
        } catch {
          // Fallback to filename-based label.
        }
      }
    }

    results.push({
      ref: getContextRef(relPath),
      label,
      type,
      path: relPath,
      detail: `${formatBytes(stat.size)} · modified ${stat.mtime.toISOString().slice(0, 10)}`,
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size,
      score
    });
  }

  async function addDirectPathMatches() {
    if (!normalizedQuery.includes('/')) return;
    const relQuery = query.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relQuery || relQuery.split('/').some(part => !part || part === '.' || part === '..')) return;
    const roomManaged = relQuery === ROOM_DIR || relQuery.startsWith(`${ROOM_DIR}/`);
    const roomRelativePath = roomManaged ? relQuery.slice(ROOM_DIR.length).replace(/^\/+/, '') : '';
    const candidatePath = roomManaged
      ? resolveWithinRoomData(roomId, roomRelativePath)
      : root
        ? await resolveCanonicalWithinProject(root, relQuery)
        : '';
    if (!candidatePath) return;
    const stat = await fs.stat(candidatePath).catch(() => null);
    if (!stat) return;
    if (stat.isFile()) {
      await addFileResult(candidatePath, 900, roomManaged);
      return;
    }
    if (!stat.isDirectory()) return;

    let added = 0;
    async function walkDirect(dirPath: string) {
      if (added >= CONTEXT_SEARCH_RESULT_LIMIT) return;
      const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const entry of entries) {
        if (added >= CONTEXT_SEARCH_RESULT_LIMIT) return;
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory() && IGNORED_WORKSPACE_DIRS.has(entry.name)) continue;
        const nextPath = path.join(dirPath, entry.name);
        const fullPath = roomManaged
          ? resolveWithinRoomData(roomId, path.relative(roomRoot, nextPath))
          : resolveWithinProject(root!, path.relative(root!, nextPath));
        if (entry.isDirectory()) {
          await walkDirect(fullPath);
        } else if (entry.isFile()) {
          added += 1;
          await addFileResult(fullPath, 850 - added, roomManaged);
        }
      }
    }
    await walkDirect(candidatePath);
  }

  async function walk(currentDir: string) {
    if (scanned >= CONTEXT_SEARCH_SCAN_LIMIT) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (scanned >= CONTEXT_SEARCH_SCAN_LIMIT) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && IGNORED_WORKSPACE_DIRS.has(entry.name)) continue;

      const fullPath = resolveWithinProject(root!, path.relative(root!, path.join(currentDir, entry.name)));
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      scanned += 1;
      await addFileResult(fullPath);
    }
  }

  async function walkRoom(currentDir: string) {
    if (scanned >= CONTEXT_SEARCH_SCAN_LIMIT) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (scanned >= CONTEXT_SEARCH_SCAN_LIMIT) return;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walkRoom(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      await addFileResult(fullPath, undefined, true);
    }
  }

  await addDirectPathMatches();
  if (root) await walk(root);
  await walkRoom(roomRoot);
  const byRef = new Map<string, ContextSearchResult & { score: number }>();
  for (const result of results) {
    const existing = byRef.get(result.ref);
    if (!existing || result.score > existing.score) byRef.set(result.ref, result);
  }
  return Array.from(byRef.values())
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, CONTEXT_SEARCH_RESULT_LIMIT)
    .map(({ score, ...result }) => result);
}
