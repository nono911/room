import * as path from 'path';
import type { RoomSource } from '@room/engine';
import type { WorkspaceFileItem } from './workspace-files.js';
import { walkPinnedSource } from './pinned-source.js';

export async function searchPinnedSourceContext(
  source: RoomSource,
  entryLimit: number,
  previewBytes: number,
  previewBudgetBytes: number,
  maxPreviewFileBytes: number
): Promise<Array<WorkspaceFileItem & { preview: string }>> {
  const walked = await walkPinnedSource(source, '', entryLimit, 32, {
    includePreviews: true,
    previewBytes,
    previewBudgetBytes,
    maxPreviewFileBytes
  });
  return walked.entries
    .filter(entry => entry.kind === 'file')
    .map(entry => ({
      path: entry.path!,
      name: entry.name,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      kind: 'file' as const,
      extension: path.extname(entry.name).slice(1).toLowerCase() || undefined,
      preview: entry.previewBase64
        ? Buffer.from(entry.previewBase64, 'base64').toString('utf-8')
        : ''
    }));
}
