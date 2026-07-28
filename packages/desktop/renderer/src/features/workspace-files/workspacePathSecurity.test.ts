// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';
import type { RoomSource } from '@room/engine';
import { resolveCanonicalWithinProject } from '../../../../main/ipc/shared.js';
import { normalizeTemporaryAgents } from '../../../../main/ipc/temporary-agents.js';
import { browseWorkspaceFiles } from '../../../../main/ipc/workspace-files.js';
import { readWorkspaceFilePreview } from '../../../../main/ipc/workspace-preview.js';
import {
  getPinnedGitStatus,
  listPinnedSourceFiles,
  scanPinnedSource
} from '../../../../main/ipc/pinned-source.js';

const execFileAsync = promisify(execFile);

async function createSymlinkFixture() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'room-workspace-paths-'));
  const projectRoot = path.join(fixtureRoot, 'project');
  const externalRoot = path.join(fixtureRoot, 'external');
  await fs.mkdir(projectRoot);
  await fs.mkdir(externalRoot);
  await fs.writeFile(path.join(projectRoot, 'inside.md'), '# Inside', 'utf-8');
  await fs.writeFile(path.join(externalRoot, 'secret.md'), '# Secret', 'utf-8');
  await fs.symlink(path.join(externalRoot, 'secret.md'), path.join(projectRoot, 'file-link.md'));
  await fs.symlink(externalRoot, path.join(projectRoot, 'directory-link'));
  const stat = await fs.lstat(projectRoot, { bigint: true });
  const source: RoomSource = {
    id: 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'directory',
    name: 'project',
    path: projectRoot,
    canonicalPath: await fs.realpath(projectRoot),
    rootDevice: stat.dev.toString(),
    rootInode: stat.ino.toString(),
    rootBirthtimeNs: stat.birthtimeNs.toString(),
    attachedAt: new Date().toISOString()
  };
  return { projectRoot, source };
}

describe('workspace source path containment', () => {
  it('allows regular source files', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await expect(resolveCanonicalWithinProject(projectRoot, 'inside.md'))
      .resolves.toBe(path.join(projectRoot, 'inside.md'));
    await expect(readWorkspaceFilePreview(source, 'inside.md'))
      .resolves.toMatchObject({ success: true, content: '# Inside' });
  });

  it('rejects a worker request for a different Source birth identity', async () => {
    const { source } = await createSymlinkFixture();
    await expect(readWorkspaceFilePreview({
      ...source,
      rootBirthtimeNs: (BigInt(source.rootBirthtimeNs) + 1n).toString()
    }, 'inside.md')).rejects.toThrow('root changed after authorization');
  });

  it('rejects hidden and ignored Source paths on direct reads and browsing', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await fs.writeFile(path.join(projectRoot, '.env'), 'SECRET=sentinel', 'utf-8');
    await fs.mkdir(path.join(projectRoot, 'node_modules'));
    await fs.writeFile(path.join(projectRoot, 'node_modules', 'secret.txt'), 'sentinel');

    await expect(readWorkspaceFilePreview(source, '.env'))
      .rejects.toThrow('Invalid Source file path');
    await expect(browseWorkspaceFiles(source, '.git'))
      .rejects.toThrow('Invalid Source file path');
    await expect(readWorkspaceFilePreview(source, 'node_modules/secret.txt'))
      .rejects.toThrow('Invalid Source file path');
  });

  it('rejects file symlinks before previewing their external targets', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await expect(resolveCanonicalWithinProject(projectRoot, 'file-link.md'))
      .rejects.toThrow(/symbolic links/i);
    await expect(readWorkspaceFilePreview(source, 'file-link.md'))
      .rejects.toThrow(/symbolic links/i);
  });

  it('rejects directory symlinks before browsing their external targets', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await expect(browseWorkspaceFiles(source, 'directory-link'))
      .rejects.toThrow(/symbolic links/i);
    await expect(resolveCanonicalWithinProject(projectRoot, 'directory-link/secret.md'))
      .rejects.toThrow(/symbolic links/i);
  });

  it('returns a bounded recursive search and directory metadata from one pinned traversal', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await fs.mkdir(path.join(projectRoot, 'src', 'nested'), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export {};\n'),
      fs.writeFile(path.join(projectRoot, 'src', 'nested', 'match.ts'), 'export {};\n')
    ]);

    const direct = await browseWorkspaceFiles(source);
    expect(direct.files.find(file => file.path === 'src')).toMatchObject({
      kind: 'directory',
      childCount: 2
    });
    const searched = await browseWorkspaceFiles(source, '', 'match');
    expect(searched.files).toEqual([
      expect.objectContaining({ path: 'src/nested/match.ts', kind: 'file' })
    ]);
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'skips an unreadable nested directory while browsing accessible siblings',
    async () => {
      const { projectRoot, source } = await createSymlinkFixture();
      const blocked = path.join(projectRoot, 'blocked');
      const accessible = path.join(projectRoot, 'accessible');
      await Promise.all([
        fs.mkdir(blocked),
        fs.mkdir(accessible)
      ]);
      await fs.writeFile(path.join(blocked, 'secret.md'), 'secret');
      await fs.writeFile(path.join(accessible, 'visible.md'), 'visible');
      await fs.chmod(blocked, 0o000);
      try {
        const result = await browseWorkspaceFiles(source, '', 'visible');
        expect(result.files).toEqual([
          expect.objectContaining({ path: 'accessible/visible.md' })
        ]);
      } finally {
        await fs.chmod(blocked, 0o700);
      }
    }
  );

  it('returns a truncated bounded result for a very large directory', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await Promise.all(Array.from({ length: 2600 }, (_, index) => (
      fs.writeFile(path.join(projectRoot, `bounded-${index}.ts`), '')
    )));

    const result = await browseWorkspaceFiles(source, '', 'bounded');
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(500);
  });

  it('reports the top-level file listing as truncated when the pinned walk truncates', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await Promise.all(Array.from({ length: 5 }, (_, index) => (
      fs.writeFile(path.join(projectRoot, `entry-${index}.txt`), '')
    )));

    // listPinnedSourceFiles must surface the worker's own truncation signal
    // instead of letting a caller re-derive it from the returned count.
    const result = await listPinnedSourceFiles(source, 3);
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(3);
  });

  it('does not report the top-level file listing as truncated when a directory has exactly the requested limit', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await Promise.all(Array.from({ length: 2 }, (_, index) => (
      fs.writeFile(path.join(projectRoot, `entry-${index}.txt`), '')
    )));
    // createSymlinkFixture already adds one real file (inside.md); the other
    // two fixture entries are symlinks the walk skips, so this is exactly 3.

    const result = await listPinnedSourceFiles(source, 3);
    expect(result.truncated).toBe(false);
    expect(result.files).toHaveLength(3);
  });

  it('reports an exact child count instead of "N+" for a directory with exactly the child-count probe limit', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    const manyDir = path.join(projectRoot, 'many');
    await fs.mkdir(manyDir);
    await Promise.all(Array.from({ length: 33 }, (_, index) => (
      fs.writeFile(path.join(manyDir, `child-${index}.txt`), '')
    )));

    const result = await browseWorkspaceFiles(source);
    expect(result.files.find(file => file.path === 'many')).toMatchObject({
      kind: 'directory',
      childCount: 33,
      childCountTruncated: false
    });
  });

  it('reads contained Git metadata without executing repository-configured filters', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await execFileAsync('/usr/bin/git', ['init', projectRoot]);
    const marker = path.join(path.dirname(projectRoot), 'filter-executed');
    await execFileAsync('/usr/bin/git', [
      '-C', projectRoot, 'config', 'filter.room.clean', `/usr/bin/touch ${marker}`
    ]);
    await fs.writeFile(path.join(projectRoot, '.gitattributes'), '*.txt filter=room\n', 'utf-8');
    await fs.writeFile(path.join(projectRoot, 'tracked.txt'), 'change', 'utf-8');

    const status = await getPinnedGitStatus(source);
    expect(status.repository).toBe(true);
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it('reports linked worktree metadata as unsupported instead of following its external pointer', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await fs.writeFile(path.join(projectRoot, '.git'), 'gitdir: /tmp/external-gitdir\n', 'utf-8');

    await expect(getPinnedGitStatus(source)).resolves.toMatchObject({
      repository: false,
      unsupportedReason: expect.stringContaining('outside the attached Source boundary')
    });
  });

  it('reads packed nested branch refs when no loose ref directory remains', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await execFileAsync('/usr/bin/git', ['init', projectRoot]);
    await execFileAsync('/usr/bin/git', ['-C', projectRoot, 'config', 'user.name', 'ROOM Test']);
    await execFileAsync('/usr/bin/git', ['-C', projectRoot, 'config', 'user.email', 'room@example.test']);
    await fs.writeFile(path.join(projectRoot, 'tracked.txt'), 'tracked', 'utf-8');
    await execFileAsync('/usr/bin/git', ['-C', projectRoot, 'add', 'tracked.txt']);
    await execFileAsync('/usr/bin/git', ['-C', projectRoot, 'commit', '-m', 'fixture']);
    await execFileAsync('/usr/bin/git', ['-C', projectRoot, 'branch', 'feature/nested']);
    await execFileAsync('/usr/bin/git', ['-C', projectRoot, 'checkout', 'feature/nested']);
    await execFileAsync('/usr/bin/git', ['-C', projectRoot, 'pack-refs', '--all', '--prune']);

    await expect(getPinnedGitStatus(source)).resolves.toMatchObject({
      repository: true,
      branch: 'feature/nested',
      commit: expect.stringMatching(/^[a-f0-9]{12}$/)
    });
  });

  it('scans beyond the interactive 500-entry browsing limit', async () => {
    const { projectRoot, source } = await createSymlinkFixture();
    await Promise.all(Array.from({ length: 520 }, (_, index) => (
      fs.writeFile(path.join(projectRoot, `file-${index}.ts`), 'export {};\n', 'utf-8')
    )));

    await expect(scanPinnedSource(source)).resolves.toMatchObject({
      fileCount: 521,
      technologies: { languages: ['TypeScript'] }
    });
  });
});

describe('temporary agent skill boundaries', () => {
  it('keeps workspace skills but strips machine skill references from runtime payloads', () => {
    const agents = normalizeTemporaryAgents([{
      id: 'tmp_reviewer',
      name: 'Temporary Reviewer',
      role: 'Reviewer',
      provider: 'gemini',
      systemPrompt: 'Review the work.',
      skills: ['room://skills/review.md', 'machine://codex/playwright']
    }]);

    expect(agents).toHaveLength(1);
    expect(agents[0].skills).toEqual(['room://skills/review.md']);
  });

  it('drops renderer-supplied Local CLI agents instead of executing unreviewed commands', () => {
    const agents = normalizeTemporaryAgents([{
      id: 'tmp_shell',
      name: 'Temporary Shell',
      role: 'Doer',
      provider: 'Local CLI',
      systemPrompt: 'Run the command.',
      cliPreset: 'none',
      command: 'sh -c malicious'
    }]);

    expect(agents).toEqual([]);
  });
});
