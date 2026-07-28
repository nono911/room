// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (...args: any[]) => Promise<unknown>>();

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null)
  },
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 })
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    })
  }
}));

import { bindCurrentRoom } from '../../../../main/ipc/shared.js';
import { registerAgentsIpc } from '../../../../main/ipc/agents.js';
import { reconcilePendingMemberDeletions } from '../../../../main/ipc/member-deletion.js';
import {
  assertMachineSkillAssignments,
  serializeMachineSkillGrantLedger
} from '../../../../main/ipc/machine-skill-grants.js';
import {
  discoveredLocalProviderEntry,
  readProvidersFromDisk,
  writeProvidersToDisk
} from '../../../../main/ipc/provider-store.js';
import { dialog } from 'electron';
import {
  machineSkillContentDigest,
  writeRoomTextFile,
  type AgentConfig
} from '@room/engine';

async function bindRoom(roomRoot: string): Promise<void> {
  const record = {
    roomRoot,
    manifest: {
      schemaVersion: 1 as const,
      id: 'room_personal',
      name: 'Personal Room',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      sources: []
    }
  };
  await fs.writeFile(path.join(roomRoot, 'room.json'), JSON.stringify(record.manifest), 'utf-8');
  bindCurrentRoom(record);
}

describe('registerAgentsIpc save-agent', () => {
  it('keeps the grant writer capacity aligned with the Room member domain', () => {
    const grant = {
      memberId: 'mem_boundary',
      provider: 'gemini',
      providerSecurityRevision: 'a'.repeat(32),
      reference: 'machine://codex/review',
      contentDigest: 'a'.repeat(64),
      approvedAt: '2026-01-01T00:00:00.000Z'
    };
    expect(() => serializeMachineSkillGrantLedger(
      Array.from({ length: 8_192 }, () => grant)
    )).not.toThrow();
    expect(() => serializeMachineSkillGrantLedger(
      Array.from({ length: 8_193 }, () => grant)
    )).toThrow('count exceeds');
  });

  beforeEach(() => {
    ipcHandlers.clear();
    registerAgentsIpc();
  });

  it('materializes a stable member id when saving a manual member without one', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-manual-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(roomRoot, { recursive: true });
    await bindRoom(roomRoot);

    const saveAgentHandler = ipcHandlers.get('save-agent');
    expect(saveAgentHandler).toBeTypeOf('function');

    const result = await saveAgentHandler?.({}, {
      roomId: 'room_personal',
      agent: {
        name: 'Manual Researcher',
        role: 'Research',
        provider: 'gemini',
        systemPrompt: 'Investigate the workspace.'
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);

    const membersDir = path.join(roomRoot, 'members');
    const files = await fs.readdir(membersDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}\.json$/);

    const saved = JSON.parse(await fs.readFile(path.join(membersDir, files[0]), 'utf-8')) as { id?: string; name: string };
    expect(saved.id).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}$/);
    expect(saved.name).toBe('Manual Researcher');
  });

  it('materializes a legacy member onto an id-backed file and removes the old legacy file when renaming', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-legacy-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(roomRoot, { recursive: true });
    await bindRoom(roomRoot);

    const membersDir = path.join(roomRoot, 'members');
    await fs.mkdir(membersDir, { recursive: true });
    await fs.writeFile(
      path.join(membersDir, 'planner.json'),
      JSON.stringify({
        name: 'Planner',
        role: 'Planning',
        provider: 'gemini',
        systemPrompt: 'Plan the work.'
      }, null, 2),
      'utf-8'
    );

    const saveAgentHandler = ipcHandlers.get('save-agent');
    expect(saveAgentHandler).toBeTypeOf('function');

    const result = await saveAgentHandler?.({}, {
      roomId: 'room_personal',
      agent: {
        previousName: 'Planner',
        name: 'Lead Planner',
        role: 'Planning',
        provider: 'gemini',
        systemPrompt: 'Plan the work.'
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);

    const files = (await fs.readdir(membersDir)).sort();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}\.json$/);
    await expect(fs.access(path.join(membersDir, 'planner.json'))).rejects.toThrow();

    const saved = JSON.parse(await fs.readFile(path.join(membersDir, files[0]), 'utf-8')) as { id?: string; name: string };
    expect(saved.id).toMatch(/^mem_[a-z0-9][a-z0-9_-]{2,80}$/);
    expect(saved.name).toBe('Lead Planner');
  });

  it('rejects Local CLI members at the persistence boundary', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-local-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(roomRoot, { recursive: true });
    await bindRoom(roomRoot);
    const handler = ipcHandlers.get('save-agent');
    const result = await handler?.({}, {
      roomId: 'room_personal',
      agent: {
        name: 'Local Runner',
        role: 'Developer',
        provider: 'Local CLI',
        systemPrompt: 'Run locally.',
        cliPreset: 'codex'
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Local CLI agents are disabled');
  });

  it('rejects an oversized duplicate machine-skill selection before approval reads', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-skill-cap-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(roomRoot, { recursive: true });
    await bindRoom(roomRoot);
    vi.mocked(dialog.showMessageBox).mockClear();
    const handler = ipcHandlers.get('save-agent');
    const result = await handler?.({ sender: {} }, {
      roomId: 'room_personal',
      agent: {
        id: 'mem_bounded_skills',
        name: 'Bounded',
        role: 'Reviewer',
        provider: 'gemini',
        systemPrompt: 'Review.',
        skills: Array.from({ length: 65 }, () => 'machine://codex/review')
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('at most 64');
    expect(vi.mocked(dialog.showMessageBox)).not.toHaveBeenCalled();
  });

  it('persists native approval bound to machine-skill content and provider', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-skill-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    const codexHome = path.join(projectRoot, 'codex-home');
    const skillRoot = path.join(codexHome, 'skills', 'review');
    await Promise.all([
      fs.mkdir(path.join(roomRoot, 'members'), { recursive: true }),
      fs.mkdir(skillRoot, { recursive: true })
    ]);
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Review\nTrusted instructions.', 'utf-8');
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await bindRoom(roomRoot);
      await writeRoomTextFile(
        { roomId: 'room_personal', roomRoot },
        ['documents', 'ledger-seed.md'],
        'seed'
      );
      const handler = ipcHandlers.get('save-agent');
      const result = await handler?.({ sender: {} }, {
        roomId: 'room_personal',
        agent: {
          id: 'mem_machine_reviewer',
          name: 'Machine Reviewer',
          role: 'Reviewer',
          provider: 'gemini',
          systemPrompt: 'Review carefully.',
          skills: ['machine://codex/review']
        }
      }) as {
        success: boolean;
        agent?: {
          id: string;
          name: string;
          role: string;
          provider: string;
          systemPrompt: string;
          skills: string[];
        };
      };

      expect(result.success).toBe(true);
      expect(vi.mocked(dialog.showMessageBox)).toHaveBeenCalled();
      expect(JSON.parse(await fs.readFile(
        path.join(roomRoot, '.room-usage.json'),
        'utf-8'
      )).entries).toBe(6);
      await expect(assertMachineSkillAssignments('room_personal', [result.agent!]))
        .resolves.toEqual([expect.objectContaining({
          memberId: 'mem_machine_reviewer',
          provider: 'gemini',
          reference: 'machine://codex/review',
          content: '# Review\nTrusted instructions.'
        })]);

      const providersPath = path.join(projectRoot, 'system', 'providers.json');
      const providers = JSON.parse(await fs.readFile(providersPath, 'utf-8'));
      const gemini = providers.providers.find(
        (provider: { id?: string }) => provider.id === 'gemini'
      );
      const approvedRevision = gemini.securityRevision;
      gemini.securityRevision = 'f'.repeat(32);
      await fs.writeFile(providersPath, JSON.stringify(providers));
      await expect(assertMachineSkillAssignments('room_personal', [result.agent!]))
        .rejects.toThrow('requires native approval');
      gemini.securityRevision = approvedRevision;
      await fs.writeFile(providersPath, JSON.stringify(providers));

      await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Review\nChanged instructions.', 'utf-8');
      await expect(assertMachineSkillAssignments('room_personal', [result.agent!]))
        .rejects.toThrow('requires native approval');
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it('requires fresh approval when a recreated member did not hold the stale skill assignment', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-orphan-grant-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    const codexHome = path.join(projectRoot, 'codex-home');
    const skillRoot = path.join(codexHome, 'skills', 'orphan-review');
    await Promise.all([
      fs.mkdir(path.join(roomRoot, 'config'), { recursive: true }),
      fs.mkdir(path.join(roomRoot, 'members'), { recursive: true }),
      fs.mkdir(skillRoot, { recursive: true })
    ]);
    const content = '# Review\nOrphaned grant instructions.';
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), content, 'utf-8');
    await fs.writeFile(
      path.join(roomRoot, 'config', 'machine-skill-grants.json'),
      serializeMachineSkillGrantLedger([{
        memberId: 'mem_orphan_reviewer',
        provider: 'gemini',
        providerSecurityRevision: 'a'.repeat(32),
        reference: 'machine://codex/orphan-review',
        contentDigest: machineSkillContentDigest(content),
        approvedAt: '2026-01-01T00:00:00.000Z'
      }]),
      'utf-8'
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await bindRoom(roomRoot);
      await fs.writeFile(
        path.join(roomRoot, 'members', 'mem_orphan_reviewer.json'),
        JSON.stringify({
          id: 'mem_orphan_reviewer',
          name: 'Recreated Reviewer',
          role: 'Reviewer',
          provider: 'gemini',
          systemPrompt: 'Review without machine skills.',
          skills: []
        })
      );
      vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1 } as never);
      const result = await ipcHandlers.get('save-agent')?.({ sender: {} }, {
        roomId: 'room_personal',
        agent: {
          id: 'mem_orphan_reviewer',
          name: 'Orphan Reviewer',
          role: 'Reviewer',
          provider: 'gemini',
          systemPrompt: 'Review carefully.',
          skills: ['machine://codex/orphan-review']
        }
      }) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('ROOM could not complete the request.');
      expect(vi.mocked(dialog.showMessageBox)).toHaveBeenCalled();
      expect(JSON.parse(await fs.readFile(
        path.join(roomRoot, 'members', 'mem_orphan_reviewer.json'),
        'utf-8'
      )).skills).toEqual([]);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it('fails closed for persisted machine-skill members without a stable id', async () => {
    await expect(assertMachineSkillAssignments('room_personal', [{
      name: 'Legacy Reviewer',
      role: 'Reviewer',
      provider: 'gemini',
      systemPrompt: 'Review carefully.',
      skills: ['machine://codex/review']
    }])).rejects.toThrow('stable member ID');
  });

  it('serializes the grant ledger and member write as one member transaction', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-transaction-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    const codexHome = path.join(projectRoot, 'codex-home');
    const skillRoot = path.join(codexHome, 'skills', 'transaction-review');
    await Promise.all([
      fs.mkdir(roomRoot, { recursive: true }),
      fs.mkdir(skillRoot, { recursive: true })
    ]);
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Review\nStable instructions.', 'utf-8');
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await bindRoom(roomRoot);
      const handler = ipcHandlers.get('save-agent')!;
      const baseAgent = {
        id: 'mem_transaction_reviewer',
        name: 'Transaction Reviewer',
        role: 'Reviewer',
        systemPrompt: 'Review carefully.',
        skills: ['machine://codex/transaction-review']
      };
      const [first, second] = await Promise.all([
        handler({ sender: {} }, {
          roomId: 'room_personal',
          agent: { ...baseAgent, provider: 'gemini' }
        }),
        handler({ sender: {} }, {
          roomId: 'room_personal',
          agent: { ...baseAgent, provider: 'anthropic' }
        })
      ]) as Array<{ success: boolean }>;

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      const persisted = JSON.parse(await fs.readFile(
        path.join(roomRoot, 'members', 'mem_transaction_reviewer.json'),
        'utf-8'
      ));
      expect(persisted.provider).toBe('anthropic');
      await expect(assertMachineSkillAssignments('room_personal', [persisted]))
        .resolves.toEqual([expect.objectContaining({
          memberId: 'mem_transaction_reviewer',
          provider: 'anthropic',
          content: '# Review\nStable instructions.'
        })]);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it('saves a skill-less member on an auto-discovered local provider', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-local-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(roomRoot, { recursive: true });
    await bindRoom(roomRoot);
    vi.mocked(dialog.showMessageBox).mockClear();

    const result = await ipcHandlers.get('save-agent')?.({ sender: {} }, {
      roomId: 'room_personal',
      agent: {
        id: 'mem_local_builder',
        name: 'Local Builder',
        role: 'Developer',
        provider: 'ollama',
        systemPrompt: 'Build locally.'
      }
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);
    expect(vi.mocked(dialog.showMessageBox)).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(
      path.join(roomRoot, 'members', 'mem_local_builder.json'),
      'utf-8'
    )).provider).toBe('ollama');
  });

  it('binds machine-skill approval to the discovered revision an auto-discovered local provider runs with', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-local-skill-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    const codexHome = path.join(projectRoot, 'codex-home');
    const skillRoot = path.join(codexHome, 'skills', 'local-review');
    await Promise.all([
      fs.mkdir(path.join(roomRoot, 'members'), { recursive: true }),
      fs.mkdir(skillRoot, { recursive: true })
    ]);
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Review\nLocal instructions.', 'utf-8');
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await bindRoom(roomRoot);
      const result = await ipcHandlers.get('save-agent')?.({ sender: {} }, {
        roomId: 'room_personal',
        agent: {
          id: 'mem_local_reviewer',
          name: 'Local Reviewer',
          role: 'Reviewer',
          provider: 'ollama',
          systemPrompt: 'Review carefully.',
          skills: ['machine://codex/local-review']
        }
      }) as { success: boolean; agent?: AgentConfig };

      expect(result.success).toBe(true);
      expect(vi.mocked(dialog.showMessageBox)).toHaveBeenCalled();

      // A run resolves the provider through discovery, so the grant must match
      // the entry `readProvidersFromDisk` appends for a running local service.
      const discovered = discoveredLocalProviderEntry('ollama');
      expect(discovered).not.toBeNull();
      await expect(assertMachineSkillAssignments(
        'room_personal',
        [result.agent!],
        [discovered!]
      )).resolves.toEqual([expect.objectContaining({
        memberId: 'mem_local_reviewer',
        provider: 'ollama',
        reference: 'machine://codex/local-review',
        content: '# Review\nLocal instructions.'
      })]);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it('keeps a persisted local-provider entry authoritative over the deterministic discovered revision', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-save-agent-persisted-local-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    const codexHome = path.join(projectRoot, 'codex-home');
    const skillRoot = path.join(codexHome, 'skills', 'persisted-local-review');
    await Promise.all([
      fs.mkdir(path.join(roomRoot, 'members'), { recursive: true }),
      fs.mkdir(skillRoot, { recursive: true })
    ]);
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Review\nPersisted local instructions.', 'utf-8');
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await bindRoom(roomRoot);

      // Persist an `ollama` entry with a security revision distinct from the
      // deterministic one `discoveredLocalProviderEntry` derives for a running,
      // unpersisted local service. Retargeting `ollama` to an attacker-controlled
      // baseUrl only invalidates existing grants if the persisted entry — not the
      // deterministic fallback — is what approval and execution both resolve to.
      const discovered = discoveredLocalProviderEntry('ollama');
      expect(discovered).not.toBeNull();
      const persistedRevision = 'b'.repeat(32);
      expect(discovered!.securityRevision).not.toBe(persistedRevision);
      const existing = await readProvidersFromDisk(projectRoot);
      await writeProvidersToDisk(
        [...existing, { ...discovered!, securityRevision: persistedRevision }],
        projectRoot
      );

      const result = await ipcHandlers.get('save-agent')?.({ sender: {} }, {
        roomId: 'room_personal',
        agent: {
          id: 'mem_persisted_local_reviewer',
          name: 'Persisted Local Reviewer',
          role: 'Reviewer',
          provider: 'ollama',
          systemPrompt: 'Review carefully.',
          skills: ['machine://codex/persisted-local-review']
        }
      }) as { success: boolean; agent?: AgentConfig };

      expect(result.success).toBe(true);
      expect(vi.mocked(dialog.showMessageBox)).toHaveBeenCalled();

      const grantsRaw = JSON.parse(await fs.readFile(
        path.join(roomRoot, 'config', 'machine-skill-grants.json'),
        'utf-8'
      )) as { grants: Array<{ memberId: string; provider: string; providerSecurityRevision: string }> };
      expect(grantsRaw.grants).toEqual([expect.objectContaining({
        memberId: 'mem_persisted_local_reviewer',
        provider: 'ollama',
        providerSecurityRevision: persistedRevision
      })]);

      // The grant is bound to the persisted revision, so a registry containing
      // only the deterministic discovered entry must fail closed.
      await expect(assertMachineSkillAssignments(
        'room_personal',
        [result.agent!],
        [discovered!]
      )).rejects.toThrow('requires native approval');
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it('keeps a member retryable when reference cleanup fails before deletion', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-delete-agent-retry-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await fs.mkdir(path.join(roomRoot, 'members'), { recursive: true });
    await fs.mkdir(path.join(roomRoot, 'config'), { recursive: true });
    await fs.mkdir(path.join(roomRoot, 'teams'), { recursive: true });
    await bindRoom(roomRoot);
    await fs.writeFile(
      path.join(roomRoot, 'members', 'mem_retryable.json'),
      JSON.stringify({
        id: 'mem_retryable',
        name: 'Retryable',
        role: 'Reviewer',
        provider: 'gemini',
        systemPrompt: 'Review carefully.'
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(roomRoot, 'config', 'machine-skill-grants.json'),
      '{',
      'utf-8'
    );
    await fs.writeFile(
      path.join(roomRoot, 'teams', 'team_retry.json'),
      JSON.stringify({
        id: 'team_retry',
        name: 'Retry team',
        memberIds: ['mem_retryable'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }),
      'utf-8'
    );

    const handler = ipcHandlers.get('delete-agent')!;
    const failed = await handler({}, {
      roomId: 'room_personal',
      agentName: 'Retryable',
      memberId: 'mem_retryable'
    }) as { success: boolean };

    expect(failed.success).toBe(false);
    await expect(fs.access(
      path.join(roomRoot, 'members', 'mem_retryable.json')
    )).resolves.toBeUndefined();
    expect(JSON.parse(await fs.readFile(
      path.join(roomRoot, 'teams', 'team_retry.json'),
      'utf-8'
    )).memberIds).toEqual(['mem_retryable']);

    await fs.writeFile(
      path.join(roomRoot, 'config', 'machine-skill-grants.json'),
      '{"grants":[]}',
      'utf-8'
    );
    const retried = await handler({}, {
      roomId: 'room_personal',
      agentName: 'Retryable',
      memberId: 'mem_retryable'
    }) as { success: boolean };

    expect(retried.success).toBe(true);
    await expect(fs.access(
      path.join(roomRoot, 'members', 'mem_retryable.json')
    )).rejects.toThrow();

    const idempotent = await handler({}, {
      roomId: 'room_personal',
      agentName: 'Retryable',
      memberId: 'mem_retryable'
    }) as { success: boolean };
    expect(idempotent.success).toBe(true);
  });

  it('refuses name-only deletion of an ID-backed member and preserves its grants', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-delete-agent-id-required-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await Promise.all([
      fs.mkdir(path.join(roomRoot, 'members'), { recursive: true }),
      fs.mkdir(path.join(roomRoot, 'config'), { recursive: true })
    ]);
    await bindRoom(roomRoot);
    const memberPath = path.join(roomRoot, 'members', 'mem_protected.json');
    const grantPath = path.join(roomRoot, 'config', 'machine-skill-grants.json');
    await fs.writeFile(memberPath, JSON.stringify({
      id: 'mem_protected',
      name: 'Protected',
      role: 'Reviewer',
      provider: 'gemini',
      systemPrompt: 'Review carefully.',
      skills: ['machine://codex/review']
    }));
    await fs.writeFile(grantPath, serializeMachineSkillGrantLedger([{
      memberId: 'mem_protected',
      provider: 'gemini',
      providerSecurityRevision: 'a'.repeat(32),
      reference: 'machine://codex/review',
      contentDigest: 'a'.repeat(64),
      approvedAt: '2026-01-01T00:00:00.000Z'
    }]));

    const result = await ipcHandlers.get('delete-agent')?.({}, {
      roomId: 'room_personal',
      agentName: 'mem_protected'
    }) as { success: boolean; error?: string };

    expect(result).toEqual({
      success: false,
      error: 'Agent deletion requires a stable member ID.'
    });
    await expect(fs.access(memberPath)).resolves.toBeUndefined();
    expect(JSON.parse(await fs.readFile(grantPath, 'utf-8')).grants)
      .toHaveLength(1);
  });

  it('reconciles a deletion tombstone after a crash without leaving team or grant references', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-delete-agent-recovery-'));
    const roomRoot = path.join(projectRoot, 'rooms', 'room_personal');
    await Promise.all([
      fs.mkdir(path.join(roomRoot, 'members'), { recursive: true }),
      fs.mkdir(path.join(roomRoot, 'config'), { recursive: true }),
      fs.mkdir(path.join(roomRoot, 'teams'), { recursive: true })
    ]);
    await bindRoom(roomRoot);
    await fs.writeFile(
      path.join(roomRoot, 'members', '.deleting-mem_recoverable'),
      JSON.stringify({
        id: 'mem_recoverable',
        name: 'Recoverable',
        role: 'Reviewer',
        provider: 'gemini',
        systemPrompt: 'Review carefully.'
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(roomRoot, 'config', 'machine-skill-grants.json'),
      serializeMachineSkillGrantLedger([{
        memberId: 'mem_recoverable',
        provider: 'gemini',
        providerSecurityRevision: 'a'.repeat(32),
        reference: 'machine://codex/review',
        contentDigest: 'a'.repeat(64),
        approvedAt: '2026-01-01T00:00:00.000Z'
      }]),
      'utf-8'
    );
    await fs.writeFile(
      path.join(roomRoot, 'teams', 'team_recovery.json'),
      JSON.stringify({
        id: 'team_recovery',
        name: 'Recovery team',
        memberIds: ['mem_recoverable'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }),
      'utf-8'
    );

    await reconcilePendingMemberDeletions('room_personal');

    await expect(fs.access(
      path.join(roomRoot, 'members', '.deleting-mem_recoverable')
    )).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(
      path.join(roomRoot, 'config', 'machine-skill-grants.json'),
      'utf-8'
    )).grants).toEqual([]);
    expect(JSON.parse(await fs.readFile(
      path.join(roomRoot, 'teams', 'team_recovery.json'),
      'utf-8'
    )).memberIds).toEqual([]);
  });
});
