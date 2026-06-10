import * as fs from 'fs/promises';
import * as path from 'path';

export interface AdrContentOptions {
  context?: string;
  decision?: string;
}

export async function createNewADR(
  dirPath: string,
  title: string,
  options: AdrContentOptions = {}
): Promise<string> {
  const decisionsDir = path.join(dirPath, '.room', 'decisions');
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
  const kebabTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const filename = `ADR-${nextNumStr}-${kebabTitle}.md`;
  const filePath = path.join(decisionsDir, filename);

  const adrContent = `# ADR-${nextNumStr}: ${title}

- **Status**: Proposed
- **Date**: ${new Date().toISOString().split('T')[0]}
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
  return filename;
}
