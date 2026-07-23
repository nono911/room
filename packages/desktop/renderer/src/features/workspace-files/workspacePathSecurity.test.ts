// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  normalizeTemporaryAgents,
  resolveCanonicalWithinProject
} from '../../../../main/ipc/shared.js';
import { browseWorkspaceFiles } from '../../../../main/ipc/workspace-files.js';
import { readWorkspaceFilePreview } from '../../../../main/ipc/workspace-preview.js';

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
  return { projectRoot };
}

describe('workspace source path containment', () => {
  it('allows regular source files', async () => {
    const { projectRoot } = await createSymlinkFixture();
    await expect(resolveCanonicalWithinProject(projectRoot, 'inside.md'))
      .resolves.toBe(path.join(projectRoot, 'inside.md'));
    await expect(readWorkspaceFilePreview(projectRoot, 'inside.md'))
      .resolves.toMatchObject({ success: true, content: '# Inside' });
  });

  it('rejects file symlinks before previewing their external targets', async () => {
    const { projectRoot } = await createSymlinkFixture();
    await expect(resolveCanonicalWithinProject(projectRoot, 'file-link.md'))
      .rejects.toThrow(/symbolic links/i);
    await expect(readWorkspaceFilePreview(projectRoot, 'file-link.md'))
      .rejects.toThrow(/symbolic links/i);
  });

  it('rejects directory symlinks before browsing their external targets', async () => {
    const { projectRoot } = await createSymlinkFixture();
    await expect(browseWorkspaceFiles(projectRoot, 'directory-link'))
      .rejects.toThrow(/symbolic links/i);
    await expect(resolveCanonicalWithinProject(projectRoot, 'directory-link/secret.md'))
      .rejects.toThrow(/symbolic links/i);
  });
});

describe('temporary agent skill boundaries', () => {
  it('keeps workspace skills but strips machine skill references from runtime payloads', () => {
    const agents = normalizeTemporaryAgents([{
      name: 'Temporary Reviewer',
      role: 'Reviewer',
      provider: 'gemini',
      systemPrompt: 'Review the work.',
      skills: ['review.md', 'machine://codex/playwright']
    }]);

    expect(agents).toHaveLength(1);
    expect(agents[0].skills).toEqual(['review.md']);
  });
});
