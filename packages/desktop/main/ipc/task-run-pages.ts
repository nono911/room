import {
  parseTaskCanonicalHeader,
  readRoomTextFilePrefix
} from '@room/engine';
import type { TaskRunSummary } from '../../shared/types/domain.js';
import { requireBoundRoomWorkspace } from './shared.js';
import { parseRendererProvenance } from './renderer-safe.js';
import { listRoomTaskRunPageNames } from './room-artifact-pages.js';

export async function listRoomTaskRunPage(
  roomId: string,
  cursor?: string
): Promise<{
  taskRuns: TaskRunSummary[];
  nextCursor?: string;
  hasMore: boolean;
  truncated: boolean;
}> {
  const page = await listRoomTaskRunPageNames(roomId, cursor);
  const workspace = requireBoundRoomWorkspace(roomId);
  const taskRuns = await Promise.all(page.files.map(async filename => {
    const id = filename.replace(/\.json$/i, '');
    const virtualFilename = `${id}.md`;
    try {
      const header = parseTaskCanonicalHeader(await readRoomTextFilePrefix(
        workspace,
        ['tasks', filename],
        64 * 1024
      ));
      return {
        filename: virtualFilename,
        id: header.id,
        title: header.title,
        status: header.status,
        cycles: header.cycles,
        statusSummary: header.statusSummary,
        associatedCardId: header.associatedCardId,
        sourceProvenance: parseRendererProvenance(header.sourceProvenance)
      } satisfies TaskRunSummary;
    } catch {}
    return {
      filename: virtualFilename,
      id,
      title: id,
      status: 'unknown',
      cycles: 0
    } satisfies TaskRunSummary;
  }));
  return {
    taskRuns,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    truncated: page.truncated
  };
}
