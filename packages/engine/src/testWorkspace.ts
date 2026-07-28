import * as path from 'path';
import type { WorkspaceLocation } from './workspace.js';

export function testWorkspace(root: string): WorkspaceLocation {
  return {
    roomId: 'room_test',
    roomRoot: path.join(root, '.room'),
    sourceId: 'source_00000000000000000000000000000000',
    sourceName: 'Test Source',
    sourceRoot: root
  };
}
