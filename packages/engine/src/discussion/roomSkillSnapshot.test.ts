import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { testWorkspace } from '../testWorkspace.js';
import { snapshotRoomSkills } from './roomSkillSnapshot.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

describe('Room skill run snapshots', () => {
  it('does not charge inactive valid skills against the active run snapshot', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-skill-snapshot-'));
    roots.push(root);
    const skillsDir = path.join(root, '.room', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });
    const inactiveContent = `---\ntriggerKeywords: ["never-match"]\n---\n${'x'.repeat(500 * 1024)}`;
    await Promise.all(Array.from({ length: 33 }, (_, index) => (
      fs.writeFile(
        path.join(skillsDir, `inactive-${String(index).padStart(2, '0')}.md`),
        inactiveContent,
        'utf-8'
      )
    )));
    await fs.writeFile(
      path.join(skillsDir, 'selected.md'),
      '# Selected\nUse the selected sentinel.',
      'utf-8'
    );

    const snapshots = await snapshotRoomSkills(testWorkspace(root), {
      references: ['room://skills/selected.md'],
      discussionText: 'unrelated work'
    });

    expect(snapshots).toEqual([
      expect.objectContaining({
        reference: 'room://skills/selected.md',
        content: '# Selected\nUse the selected sentinel.'
      })
    ]);
  });

  it('keeps same-named skill and role files as distinct immutable identities', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-skill-identity-'));
    roots.push(root);
    await Promise.all([
      fs.mkdir(path.join(root, '.room', 'skills'), { recursive: true }),
      fs.mkdir(path.join(root, '.room', 'roles'), { recursive: true })
    ]);
    await fs.writeFile(
      path.join(root, '.room', 'skills', 'quality.md'),
      '---\nalwaysApply: true\n---\nSkill sentinel.'
    );
    await fs.writeFile(
      path.join(root, '.room', 'roles', 'quality.md'),
      'Role sentinel.'
    );

    const snapshots = await snapshotRoomSkills(testWorkspace(root), {
      references: ['room://roles/quality.md']
    });

    expect(snapshots.map(snapshot => snapshot.reference).sort()).toEqual([
      'room://roles/quality.md',
      'room://skills/quality.md'
    ]);
    expect(snapshots.find(snapshot => snapshot.source === 'roles')?.content)
      .toBe('Role sentinel.');
    expect(snapshots.find(snapshot => snapshot.source === 'skills')?.content)
      .toContain('Skill sentinel.');
  });
});
