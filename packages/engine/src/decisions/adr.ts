import * as fs from 'fs/promises';
import * as path from 'path';
import { withRoomDataLock } from '../roomHome.js';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';
import { readRoomTextFile, writeRoomTextFile } from '../roomFile.js';
import { listDirectoryNamesBounded } from '../boundedFs.js';

export interface AdrContentOptions {
  context?: string;
  decision?: string;
}

export async function createNewADR(
  workspace: WorkspaceInput,
  title: string,
  options: AdrContentOptions = {}
): Promise<{ id: string; filename: string; created: boolean }> {
  const decisionsDir = resolveRoomPath(workspace, 'decisions');
  const roomRoot = resolveRoomPath(workspace);
  return withRoomDataLock(roomRoot, 'decisions', async () => {
    await fs.mkdir(decisionsDir, { recursive: true });

    const listing = await listDirectoryNamesBounded(decisionsDir, 1_000);
    if (listing.truncated) {
      throw new Error('ROOM decision directory exceeds its entry limit.');
    }
    const files = listing.names;
    let maxNum = 0;

    for (const file of files) {
      const match = file.match(/^ADR-(\d+)-/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) {
          maxNum = num;
        }
      }
    }

    const nextNum = maxNum + 1;
    const nextNumStr = String(nextNum).padStart(3, '0');
    let kebabTitle = title
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/(^-|-$)/g, '');

    if (!kebabTitle) {
      kebabTitle = 'decision';
    }

    for (const file of files) {
      const match = file.match(/^ADR-\d+-(.+)\.md$/i);
      if (match && match[1].normalize('NFC').toLowerCase() === kebabTitle.normalize('NFC').toLowerCase()) {
        return {
          id: await readExistingAdrId(workspace, file),
          filename: file,
          created: false
        };
      }
    }

    const id = `adr-${nextNumStr}`;
    const filename = `ADR-${nextNumStr}-${kebabTitle}.md`;
    const filePath = path.join(decisionsDir, filename);
    const createdAt = new Date().toISOString();

    const adrContent = `---
id: ${id}
title: ${JSON.stringify(title)}
createdAt: ${JSON.stringify(createdAt)}
---

# ADR-${nextNumStr}: ${title}

- **Status**: Proposed
- **Date**: ${createdAt.split('T')[0]}
- **Author**: ROOM Engine

## Context and Problem Statement
${options.context || 'Define the architectural challenge and context.'}

## Decision Drivers
- Driver 1
- Driver 2

## Considered Options
- Option 1
- Option 2

## Decision Outcome
${options.decision || 'Chosen Option: Option X, because ...'}

### Consequences
- Good consequences
- Bad consequences
`;

    await writeRoomTextFile(workspace, ['decisions', filename], adrContent);
    return { id, filename, created: true };
  });
}

async function readExistingAdrId(
  workspace: WorkspaceInput,
  filename: string
): Promise<string> {
  try {
    const content = await readRoomTextFile(
      workspace,
      ['decisions', filename],
      256 * 1024
    );
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    const idLine = frontmatter?.[1].match(/^id:\s*(\S+)\s*$/m);
    if (idLine) {
      return idLine[1];
    }
  } catch {
    // Fall through to the filename-derived id for unreadable files.
  }
  const numberMatch = filename.match(/^ADR-(\d+)-/i);
  return `adr-${(numberMatch?.[1] || '0').padStart(3, '0')}`;
}
