// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { RoomSource } from '@room/engine';
import { withSourceOperationQueue } from '../../main/ipc/source-operation-queue.js';

const source: RoomSource = {
  id: 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  type: 'directory',
  name: 'Source',
  path: '/tmp/source',
  canonicalPath: '/tmp/source',
  rootDevice: '1',
  rootInode: '2',
  rootBirthtimeNs: '3',
  attachedAt: new Date().toISOString()
};

describe('Source operation queue', () => {
  it('serializes the same Source ID across a directory move', async () => {
    let release = (): void => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let entered = (): void => {};
    const firstEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    let secondEntered = false;
    const first = withSourceOperationQueue(source, async () => {
      entered();
      await gate;
    });
    await firstEntered;
    const moved = {
      ...source,
      path: '/tmp/moved',
      canonicalPath: '/tmp/moved'
    };
    const second = withSourceOperationQueue(moved, async () => {
      secondEntered = true;
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(secondEntered).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
  });

  it('rejects admission beyond the bounded running and pending operation count', async () => {
    let release = (): void => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let entered = (): void => {};
    const firstEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const first = withSourceOperationQueue(source, async () => {
      entered();
      await gate;
    });
    await firstEntered;
    const queued = Array.from({ length: 3 }, (_, index) => (
      withSourceOperationQueue({
        ...source,
        path: `/tmp/source-${index}`,
        canonicalPath: `/tmp/source-${index}`
      }, async () => undefined)
    ));

    await expect(withSourceOperationQueue({
      ...source,
      path: '/tmp/source-overflow',
      canonicalPath: '/tmp/source-overflow'
    }, async () => undefined))
      .rejects.toThrow('Too many pending operations');
    release();
    await Promise.all([first, ...queued]);
  });
});
