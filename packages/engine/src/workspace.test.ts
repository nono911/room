import { describe, expect, it } from 'vitest';
import {
  resolveSourceStatePath,
  resolveWorkspaceLocation
} from './workspace.js';

describe('Room workspace identity', () => {
  it('requires a Room identity instead of accepting an absolute path', () => {
    expect(() => resolveWorkspaceLocation('/tmp/source' as never))
      .toThrow('Room location must use a Room ID');
    expect(() => resolveWorkspaceLocation({
      roomId: '../escape',
      roomRoot: '/tmp/room'
    })).toThrow('Invalid Room ID');
  });

  it('requires a valid Source ID and absolute Source root together', () => {
    expect(() => resolveWorkspaceLocation({
      roomId: 'room_test',
      roomRoot: '/tmp/room',
      sourceId: '../escape',
      sourceRoot: '/tmp/source'
    })).toThrow('Source ID and absolute Source root');
    expect(() => resolveSourceStatePath({
      roomId: 'room_test',
      roomRoot: '/tmp/room'
    }, 'scan')).toThrow('Source ID');
  });
});
