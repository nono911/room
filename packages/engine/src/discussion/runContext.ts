import {
  resolveRoomPath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from '../workspace.js';
import * as path from 'path';
import { withCurrentScanSnapshot } from '../scanSnapshot.js';
import { readFirstExistingUtf8Bounded } from '../boundedFs.js';

export interface RunContextFiles {
  overview: string;
  structure: string;
}

export async function loadRunContextFiles(workspace: WorkspaceInput): Promise<RunContextFiles> {
  const roomOverview = await readFirstExistingUtf8Bounded([
    resolveRoomPath(workspace, 'context', 'overview.md'),
    resolveRoomPath(workspace, 'workspace.md'),
    resolveRoomPath(workspace, 'project.md')
  ], 1024 * 1024);
  const roomStructure = await readFirstExistingUtf8Bounded([
    resolveRoomPath(workspace, 'context', 'structure.md'),
    resolveRoomPath(workspace, 'architecture', 'current.md')
  ], 1024 * 1024);
  const resolvedWorkspace = resolveWorkspaceLocation(workspace);
  const sourceContext = resolvedWorkspace.sourceId
    ? await withCurrentScanSnapshot(workspace, async sourceSnapshot => ({
        overview: await readFirstExistingUtf8Bounded(
          [path.join(sourceSnapshot, 'overview.md')],
          1024 * 1024
        ),
        structure: await readFirstExistingUtf8Bounded(
          [path.join(sourceSnapshot, 'structure.md')],
          1024 * 1024
        )
      }))
    : undefined;
  const sourceOverview = sourceContext?.overview || '';
  const sourceStructure = sourceContext?.structure || '';

  return {
    overview: [
      roomOverview,
      sourceOverview ? `Active Source Overview:\n${sourceOverview}` : ''
    ].filter(Boolean).join('\n\n'),
    structure: [
      roomStructure,
      sourceStructure ? `Active Source Structure:\n${sourceStructure}` : ''
    ].filter(Boolean).join('\n\n')
  };
}
