// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() =>
  new Map<string, (...args: unknown[]) => Promise<unknown>>()
);

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    })
  }
}));

import {
  finishControlledRun,
  getRunInterruptMessage,
  interruptRunsForOwner,
  registerRunControlIpc,
  startControlledRun
} from '../../main/ipc/run-control.js';

describe('controlled run ownership', () => {
  it('rejects a duplicate active run in one Room without affecting another Room', () => {
    startControlledRun('room_first', 'task-shared');
    try {
      expect(() => startControlledRun('room_first', 'task-shared'))
        .toThrow('already active');
      expect(() => startControlledRun('room_second', 'task-shared'))
        .not.toThrow();
      expect(getRunInterruptMessage('room_first', 'task-shared')).toBeNull();
    } finally {
      finishControlledRun('room_first', 'task-shared');
      finishControlledRun('room_second', 'task-shared');
    }
  });

  it('interrupts only the closed window\'s runs, and never overwrites a user interrupt', async () => {
    startControlledRun('room_first', 'task-owned', 7);
    startControlledRun('room_first', 'task-other-window', 9);
    startControlledRun('room_first', 'task-user-pivoted', 7);
    handlers.clear();
    registerRunControlIpc();
    await handlers.get('interrupt-run')?.({}, {
      roomId: 'room_first',
      runId: 'task-user-pivoted',
      message: 'Focus on the migration instead.'
    });

    try {
      expect(interruptRunsForOwner(7)).toBe(1);
      expect(getRunInterruptMessage('room_first', 'task-owned'))
        .toContain('window was closed');
      expect(getRunInterruptMessage('room_first', 'task-other-window')).toBeNull();
      expect(getRunInterruptMessage('room_first', 'task-user-pivoted'))
        .toBe('Focus on the migration instead.');
      // Already interrupted runs are not re-flagged on a second close.
      expect(interruptRunsForOwner(7)).toBe(0);
    } finally {
      finishControlledRun('room_first', 'task-owned');
      finishControlledRun('room_first', 'task-other-window');
      finishControlledRun('room_first', 'task-user-pivoted');
    }
  });

  it('rejects oversized controlled and interrupt run IDs before storing map keys', async () => {
    const oversized = `task-${'a'.repeat(200)}`;
    expect(() => startControlledRun('room_first', oversized))
      .toThrow('Invalid controlled run identity');

    handlers.clear();
    registerRunControlIpc();
    const interrupt = handlers.get('interrupt-run');
    await expect(interrupt?.({}, {
      roomId: 'room_first',
      runId: oversized,
      message: 'Stop now.'
    })).resolves.toEqual({ success: false, error: 'Invalid run id.' });
  });
});
