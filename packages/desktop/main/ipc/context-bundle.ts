import {
  parseTaskCanonical,
  readRoomTextFile,
  renderCodingTaskMarkdown,
  renderDiscussionMarkdown
} from '@room/engine';
import {
  DISCUSSION_CONTEXT_FILE_LIMIT_BYTES,
  DISCUSSION_CONTEXT_TOTAL_LIMIT,
  requireBoundRoomWorkspace,
  sanitizeFileName,
  sanitizeWorkspaceRelativePath
} from './shared.js';
import { readPinnedSourceFile } from './pinned-source.js';

function normalizeContextRef(rawRef: unknown): string | null {
  if (typeof rawRef !== 'string') return null;
  const ref = rawRef.trim();
  return ref || null;
}

async function readTextFileWithLimit(
  source: import('@room/engine').RoomSource,
  relativePath: string
): Promise<string> {
  const { buffer, size } = await readPinnedSourceFile(
    source,
    relativePath,
    DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
  );
  if (size > DISCUSSION_CONTEXT_FILE_LIMIT_BYTES) {
    throw new Error('File is too large to include as discussion context.');
  }
  if (buffer.includes(0)) throw new Error('Binary files cannot be included as discussion context.');
  return buffer.toString('utf-8');
}

async function readFirstRoomFile(
  roomId: string,
  candidates: Array<[string, string]>
): Promise<string> {
  for (const parts of candidates) {
    try {
      return await readRoomTextFile(
        requireBoundRoomWorkspace(roomId),
        parts,
        DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
      );
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return '';
}

async function loadContextReference(
  roomId: string,
  runSource: import('@room/engine').RoomSource | undefined,
  ref: string
): Promise<{ label: string; content: string }> {
  if (ref === 'workspace:overview' || ref === 'workspace:structure') {
    return { label: ref, content: '' };
  }
  if (ref.startsWith('source-file:')) {
    const match = ref.match(/^source-file:(source_[a-f0-9]{32}):(.+)$/);
    if (!match) throw new Error('Invalid Source file context reference.');
    if (!runSource || match[1] !== runSource.id) {
      throw new Error('Source file context must belong to the Source captured for this run.');
    }
    const relativePath = sanitizeWorkspaceRelativePath(decodeURIComponent(match[2]));
    return {
      label: `Source File: ${relativePath}`,
      content: await readTextFileWithLimit(runSource, relativePath)
    };
  }
  if (ref.startsWith('document:')) {
    const filename = sanitizeFileName(ref.slice('document:'.length));
    return {
      label: `Document: ${filename}`,
      content: await readFirstRoomFile(roomId, [
        ['documents', filename],
        ['reviews', filename],
        ['decisions', filename]
      ])
    };
  }
  if (ref.startsWith('task:')) {
    const filename = sanitizeFileName(ref.slice('task:'.length));
    if (/^task-[\w-]+\.md$/i.test(filename)) {
      const canonical = await readFirstRoomFile(roomId, [[
        'tasks',
        filename.replace(/\.md$/i, '.json')
      ]]);
      return {
        label: `Task: ${filename}`,
        content: renderCodingTaskMarkdown(parseTaskCanonical(canonical))
      };
    }
    return {
      label: `Task: ${filename}`,
      content: await readFirstRoomFile(roomId, [['tasks', filename]])
    };
  }
  if (ref.startsWith('discussion:')) {
    const filename = sanitizeFileName(ref.slice('discussion:'.length));
    if (!filename.toLowerCase().endsWith('.md')) {
      throw new Error('Only markdown discussion transcripts can be included as context.');
    }
    return {
      label: `Previous Discussion: ${filename}`,
      content: renderDiscussionMarkdown(JSON.parse(await readFirstRoomFile(
        roomId,
        [['discussions', filename.replace(/\.md$/i, '.json')]]
      )))
    };
  }
  return { label: ref, content: '' };
}

export async function buildSelectedContext(
  roomId: string,
  runSource: import('@room/engine').RoomSource | undefined,
  rawRefs: unknown
): Promise<string> {
  if (!Array.isArray(rawRefs)) return '';
  if (
    rawRefs.length > 100
    || rawRefs.some(ref => (
      typeof ref !== 'string'
      || Buffer.byteLength(ref, 'utf-8') > 4_096
    ))
  ) throw new Error('Selected context exceeds its reference limit.');
  const sections: string[] = [];
  let totalBytes = 0;

  for (const rawRef of rawRefs) {
    const ref = normalizeContextRef(rawRef);
    if (!ref) continue;
    if (ref.startsWith('source-file:')) {
      const match = ref.match(/^source-file:(source_[a-f0-9]{32}):(.+)$/);
      if (!match || !runSource || match[1] !== runSource.id) {
        throw new Error('Source file context must belong to the Source captured for this run.');
      }
    }
    let label = ref;
    let content = '';
    try {
      ({ label, content } = await loadContextReference(roomId, runSource, ref));
    } catch {
      content = '[Unable to include selected context.]';
    }
    if (!content.trim()) continue;
    const section = `\n\n---\n## ${label}\n\n${content.trim()}`;
    totalBytes += Buffer.byteLength(section, 'utf-8');
    if (totalBytes > DISCUSSION_CONTEXT_TOTAL_LIMIT) {
      sections.push('\n\n---\n## Context Limit\n\nAdditional selected context was omitted because the context bundle reached the size limit.');
      break;
    }
    sections.push(section);
  }
  return sections.join('');
}
