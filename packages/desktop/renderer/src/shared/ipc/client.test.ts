import { describe, expect, test, vi } from 'vitest';

describe('api.deleteAgent', () => {
  test('forwards optional memberId to the preload bridge', async () => {
    const deleteAgent = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.deleteAgent = deleteAgent;

    const { api } = await import('./client.js');

    await api.deleteAgent('/workspace', 'Planner', 'mem_planner');

    expect(deleteAgent).toHaveBeenCalledWith('/workspace', 'Planner', 'mem_planner');
  });

  test('preserves legacy delete calls without memberId', async () => {
    const deleteAgent = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.deleteAgent = deleteAgent;

    const { api } = await import('./client.js');

    await api.deleteAgent('/workspace', 'Planner');

    expect(deleteAgent).toHaveBeenCalledWith('/workspace', 'Planner', undefined);
  });
});
