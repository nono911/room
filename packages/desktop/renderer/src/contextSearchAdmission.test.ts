// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { withContextSearchAdmission } from '../../main/ipc/context-search-admission.js';

describe('Room context-search admission', () => {
  it('bounds overlapping searches instead of accumulating stale work', async () => {
    let release = (): void => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let enteredCount = 0;
    let bothEntered = (): void => {};
    const entered = new Promise<void>(resolve => {
      bothEntered = resolve;
    });
    const hold = () => withContextSearchAdmission('room_personal', async () => {
      enteredCount += 1;
      if (enteredCount === 2) bothEntered();
      await gate;
    });
    const active = [hold(), hold()];
    await entered;

    await expect(withContextSearchAdmission('room_personal', async () => undefined))
      .rejects.toThrow('Too many active context searches');
    release();
    await Promise.all(active);
  });
});
