import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveRoomPath, type WorkspaceInput } from '../workspace.js';

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
  await fs.mkdir(decisionsDir, { recursive: true });

  const files = await fs.readdir(decisionsDir);
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
      return { id: await readExistingAdrId(path.join(decisionsDir, file), file), filename: file, created: false };
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

  await fs.writeFile(filePath, adrContent, 'utf-8');
  return { id, filename, created: true };
}

async function readExistingAdrId(filePath: string, filename: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
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
