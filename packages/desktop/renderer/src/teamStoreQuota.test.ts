// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensurePersonalRoom,
  roomPathUsageBytes,
  validateAgentConfig
} from '@room/engine';
import { bindCurrentRoom } from '../../main/ipc/shared.js';
import {
  addMembersToTeam,
  loadTeams,
  loadTeamsWithDiagnostics,
  removeMemberFromTeams,
  saveTeam
} from '../../main/ipc/team-store.js';
import {
  executeDurableTeamTransaction,
  reconcileTeamTransactions
} from '../../main/ipc/team-store-transaction.js';

const roots: string[] = [];
const originalQuota = process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;

function journalFor(key: string, writes: Array<Record<string, unknown>>) {
  return {
    version: 2,
    key,
    writesDigest: createHash('sha256').update(JSON.stringify(writes.map(write => ({
      parts: write.parts,
      content: write.content,
      mode: write.mode
    })))).digest('hex'),
    writes
  };
}

afterEach(async () => {
  if (originalQuota === undefined) delete process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;
  else process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = originalQuota;
  await Promise.all(roots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe('team storage quota transaction', () => {
  it('bounds persisted team counts and text fields', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-team-capacity-'));
    roots.push(root);
    const room = bindCurrentRoom(await ensurePersonalRoom(path.join(root, 'home')));
    await expect(saveTeam(room.manifest.id, {
      id: 'team_oversized',
      name: 'x'.repeat(257),
      memberIds: []
    })).rejects.toThrow('size limit');

    await Promise.all(Array.from({ length: 101 }, (_, index) =>
      fs.writeFile(
        path.join(room.roomRoot, 'teams', `team_${index}.json`),
        JSON.stringify({
          id: `team_team_${index}`,
          name: `Team ${index}`,
          memberIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }),
        'utf-8'
      )
    ));
    const result = await loadTeamsWithDiagnostics(room.manifest.id);
    expect(result.teams).toEqual([]);
    expect(result.diagnostics[0]?.error).toContain('at most 100');
  });

  it('uses exact pretty-serialized overwrite bytes at the quota boundary', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-team-quota-'));
    roots.push(root);
    const room = bindCurrentRoom(await ensurePersonalRoom(path.join(root, 'home')));
    const team = await saveTeam(room.manifest.id, {
      id: 'team_product',
      name: 'Product',
      memberIds: []
    });
    const member = {
      id: 'mem_builder',
      name: 'Builder',
      role: 'Developer',
      provider: 'gemini',
      systemPrompt: 'Build the requested change.',
      skills: []
    };
    const validated = validateAgentConfig(member);
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const usageBefore = await roomPathUsageBytes(room.roomRoot);
    const teamPath = path.join(room.roomRoot, 'teams', 'team_product.json');
    const oldTeamBytes = (await fs.stat(teamPath)).size;
    const nextTeamBytes = Buffer.byteLength(JSON.stringify({
      ...team,
      memberIds: ['mem_builder'],
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf-8');
    const memberBytes = Buffer.byteLength(
      JSON.stringify(validated.agent, null, 2),
      'utf-8'
    );
    const exactFinalUsage = usageBefore + memberBytes + nextTeamBytes - oldTeamBytes;
    process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = String(exactFinalUsage);

    await expect(addMembersToTeam(
      room.manifest.id,
      team.id,
      [member]
    )).resolves.toMatchObject({
      team: { memberIds: ['mem_builder'] }
    });
    expect(await roomPathUsageBytes(room.roomRoot)).toBe(exactFinalUsage);
  });

  it('serializes member removal with concurrent team membership updates', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-team-membership-race-'));
    roots.push(root);
    const room = bindCurrentRoom(await ensurePersonalRoom(path.join(root, 'home')));
    const team = await saveTeam(room.manifest.id, {
      id: 'team_race',
      name: 'Race',
      memberIds: ['mem_removed']
    });
    const added = {
      id: 'mem_added',
      name: 'Added',
      role: 'Developer',
      provider: 'gemini',
      systemPrompt: 'Keep this member.'
    };

    await Promise.all([
      removeMemberFromTeams(room.manifest.id, 'mem_removed'),
      addMembersToTeam(room.manifest.id, team.id, [added])
    ]);
    expect((await loadTeams(room.manifest.id)).find(item => item.id === team.id)?.memberIds)
      .toEqual(['mem_added']);
  });

  it('replays a partial durable team transaction after process termination', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-team-recovery-'));
    roots.push(root);
    const room = bindCurrentRoom(await ensurePersonalRoom(path.join(root, 'home')));
    const memberContent = JSON.stringify({
      id: 'mem_recovered',
      name: 'Recovered',
      role: 'Reviewer',
      provider: 'gemini',
      systemPrompt: 'Review recovered work.',
      skills: []
    }, null, 2);
    const teamContent = JSON.stringify({
      id: 'team_recovered',
      name: 'Recovered team',
      memberIds: ['mem_recovered'],
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z'
    }, null, 2);
    const journalPath = path.join(
      room.roomRoot,
      'teams',
      '.transaction-create-team_recovered'
    );
    await fs.writeFile(
      path.join(room.roomRoot, 'members', 'mem_recovered.json'),
      memberContent
    );
    await fs.writeFile(journalPath, JSON.stringify(journalFor(
      'create-team_recovered',
      [
        {
          parts: ['members', 'mem_recovered.json'],
          content: memberContent,
          mode: 'create'
        },
        {
          parts: ['teams', 'team_recovered.json'],
          content: teamContent,
          mode: 'create'
        }
      ]
    )));

    await reconcileTeamTransactions(room.manifest.id);

    expect(await fs.readFile(
      path.join(room.roomRoot, 'teams', 'team_recovered.json'),
      'utf-8'
    )).toBe(teamContent);
    await expect(fs.access(journalPath)).rejects.toThrow();
  });

  it('never overwrites a concurrently published create target during replay', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-team-conflict-'));
    roots.push(root);
    const room = bindCurrentRoom(await ensurePersonalRoom(path.join(root, 'home')));
    const teamPath = path.join(room.roomRoot, 'teams', 'team_conflict.json');
    const externalContent = JSON.stringify({
      id: 'team_conflict',
      name: 'Concurrent team',
      memberIds: [],
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z'
    });
    const journalPath = path.join(
      room.roomRoot,
      'teams',
      '.transaction-create-team_conflict'
    );
    await fs.writeFile(journalPath, JSON.stringify(journalFor(
      'create-team_conflict',
      [{
        parts: ['teams', 'team_conflict.json'],
        content: '{"id":"team_conflict","name":"Journal team"}',
        mode: 'create'
      }]
    )));
    await fs.writeFile(teamPath, externalContent);

    await expect(reconcileTeamTransactions(room.manifest.id))
      .rejects.toThrow('conflicts');
    expect(await fs.readFile(teamPath, 'utf-8')).toBe(externalContent);
    await expect(fs.access(journalPath)).resolves.toBeUndefined();
  });

  it('rejects retrying a journal key with a different write set', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-team-journal-digest-'));
    roots.push(root);
    const room = bindCurrentRoom(await ensurePersonalRoom(path.join(root, 'home')));
    const key = 'add-team_digest';
    const oldWrites = [{
      parts: ['members', 'mem_old.json'],
      content: '{"id":"mem_old"}',
      mode: 'create'
    }];
    await fs.writeFile(
      path.join(room.roomRoot, 'teams', `.transaction-${key}`),
      JSON.stringify(journalFor(key, oldWrites))
    );

    await expect(executeDurableTeamTransaction(room.manifest.id, key, [{
      parts: ['members', 'mem_new.json'],
      content: '{"id":"mem_new"}',
      mode: 'create'
    }])).rejects.toThrow('does not match');
    await expect(fs.access(
      path.join(room.roomRoot, 'members', 'mem_old.json')
    )).rejects.toThrow();
  });

  it('blocks member creation while the same member has a deletion tombstone', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-team-tombstone-'));
    roots.push(root);
    const room = bindCurrentRoom(await ensurePersonalRoom(path.join(root, 'home')));
    const tombstone = path.join(room.roomRoot, 'members', '.deleting-mem_pending');
    await fs.writeFile(tombstone, '{}');

    await expect(addMembersToTeam(
      room.manifest.id,
      (await saveTeam(room.manifest.id, {
        id: 'team_pending',
        name: 'Pending',
        memberIds: []
      })).id,
      [{
        id: 'mem_pending',
        name: 'Pending',
        role: 'Reviewer',
        provider: 'gemini',
        systemPrompt: 'Wait for deletion recovery.'
      }]
    )).rejects.toThrow('pending deletion');
    await expect(fs.access(
      path.join(room.roomRoot, 'members', 'mem_pending.json')
    )).rejects.toThrow();
  });
});
