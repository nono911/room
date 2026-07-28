import { ipcMain } from 'electron';
import { isControlledRunId } from '@room/engine';
import { assertUtf8Bytes, IPC_LIMITS } from './ipc-limits.js';
import { toPublicError } from './public-error.js';

interface RunInterruptState {
  message: string;
  requestedAt: string;
  ownerId?: number;
}

const ORPHANED_RUN_INTERRUPT = 'The ROOM window was closed. Wrap up now and record what you have.';

const activeRunInterrupts = new Map<string, RunInterruptState>();

function runKey(roomId: string, runId: string): string {
  return `${roomId}:${runId}`;
}

export function startControlledRun(
  roomId: string,
  runId: string,
  ownerId?: number
): void {
  if (
    !/^room_[a-z0-9_-]{1,64}$/.test(roomId)
    || !isControlledRunId(runId)
  ) {
    throw new Error('Invalid controlled run identity.');
  }
  const key = runKey(roomId, runId);
  if (activeRunInterrupts.has(key)) {
    throw new Error(`Run ${runId} is already active in Room ${roomId}.`);
  }
  activeRunInterrupts.set(key, { message: '', requestedAt: '', ownerId });
}

/**
 * Interrupts runs whose renderer is gone. The engine polls the interrupt
 * message between rounds, so the run stops at a safe point and still persists a
 * terminal status instead of streaming on to a window nobody can see.
 */
export function interruptRunsForOwner(ownerId: number): number {
  let interrupted = 0;
  for (const state of activeRunInterrupts.values()) {
    if (state.ownerId !== ownerId || state.message.trim()) continue;
    state.message = ORPHANED_RUN_INTERRUPT;
    state.requestedAt = new Date().toISOString();
    interrupted += 1;
  }
  return interrupted;
}

export function finishControlledRun(roomId: string, runId: string): void {
  activeRunInterrupts.delete(runKey(roomId, runId));
}

export function getRunInterruptMessage(roomId: string, runId: string): string | null {
  const state = activeRunInterrupts.get(runKey(roomId, runId));
  if (!state?.message.trim()) return null;
  return state.message;
}

export function registerRunControlIpc(): void {
  ipcMain.handle('interrupt-run', async (
    _event,
    { roomId, runId, message }: { roomId: string; runId: string; message: string }
  ) => {
    const safeRoomId = typeof roomId === 'string' && /^room_[a-z0-9_-]{1,64}$/.test(roomId)
      ? roomId
      : '';
    const safeRunId = isControlledRunId(runId)
      ? runId
      : '';
    try {
      assertUtf8Bytes(message, 'Interrupt message', IPC_LIMITS.runTextBytes);
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
    const pivotMessage = message.trim();

    if (!safeRoomId || !safeRunId) {
      return { success: false, error: 'Invalid run id.' };
    }
    if (!pivotMessage) {
      return { success: false, error: 'Interrupt message is required.' };
    }
    const key = runKey(safeRoomId, safeRunId);
    if (!activeRunInterrupts.has(key)) {
      return { success: false, error: 'That run is not active.' };
    }

    activeRunInterrupts.set(key, {
      message: pivotMessage,
      requestedAt: new Date().toISOString()
    });
    return { success: true };
  });
}
