import { ipcMain } from 'electron';

interface RunInterruptState {
  message: string;
  requestedAt: string;
}

const activeRunInterrupts = new Map<string, RunInterruptState>();

export function startControlledRun(runId: string): void {
  activeRunInterrupts.set(runId, { message: '', requestedAt: '' });
}

export function finishControlledRun(runId: string): void {
  activeRunInterrupts.delete(runId);
}

export function getRunInterruptMessage(runId: string): string | null {
  const state = activeRunInterrupts.get(runId);
  if (!state?.message.trim()) return null;
  return state.message;
}

export function registerRunControlIpc(): void {
  ipcMain.handle('interrupt-run', async (_event, { runId, message }: { runId: string; message: string }) => {
    const safeRunId = typeof runId === 'string' && /^(discussion|task)-\d+$/.test(runId)
      ? runId
      : '';
    const pivotMessage = typeof message === 'string' ? message.trim() : '';

    if (!safeRunId) {
      return { success: false, error: 'Invalid run id.' };
    }
    if (!pivotMessage) {
      return { success: false, error: 'Interrupt message is required.' };
    }
    if (!activeRunInterrupts.has(safeRunId)) {
      return { success: false, error: 'That run is not active.' };
    }

    activeRunInterrupts.set(safeRunId, {
      message: pivotMessage,
      requestedAt: new Date().toISOString()
    });
    return { success: true };
  });
}
