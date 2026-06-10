import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createNewADR } from './adr.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-adr-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createNewADR', () => {
  it('numbers ADRs sequentially', async () => {
    const { filename: first } = await createNewADR(dir, 'Use SQLite');
    const { filename: second } = await createNewADR(dir, 'Adopt ESM');
    expect(first).toBe('ADR-001-use-sqlite.md');
    expect(second).toBe('ADR-002-adopt-esm.md');
  });

  it('fills in provided context and decision text', async () => {
    const { filename } = await createNewADR(dir, 'Use SQLite', {
      context: 'We need embedded storage.',
      decision: 'Adopt SQLite for the local store.'
    });
    const content = await fs.readFile(path.join(dir, '.room', 'decisions', filename), 'utf-8');
    expect(content).toContain('We need embedded storage.');
    expect(content).toContain('Adopt SQLite for the local store.');
    expect(content).not.toContain('Define the architectural challenge');
  });

  it('keeps template placeholders when no options are given', async () => {
    const { filename } = await createNewADR(dir, 'Use SQLite');
    const content = await fs.readFile(path.join(dir, '.room', 'decisions', filename), 'utf-8');
    expect(content).toContain('Define the architectural challenge and context.');
  });

  it('supports Thai/Unicode characters in the slug', async () => {
    const { filename } = await createNewADR(dir, 'การออกแบบระบบ');
    expect(filename).toBe('ADR-001-การออกแบบระบบ.md');
  });

  it('falls back to decision when kebab slug is empty', async () => {
    const { filename } = await createNewADR(dir, '😊!!!');
    expect(filename).toBe('ADR-001-decision.md');
  });

  it('deduplicates by returning existing filename when the title already exists', async () => {
    const { filename: first, created: firstCreated } = await createNewADR(dir, 'Unique Decision');
    const { filename: second, created: secondCreated } = await createNewADR(dir, 'Unique Decision');
    expect(first).toBe('ADR-001-unique-decision.md');
    expect(second).toBe('ADR-001-unique-decision.md');
    expect(firstCreated).toBe(true);
    expect(secondCreated).toBe(false);
    
    const files = await fs.readdir(path.join(dir, '.room', 'decisions'));
    expect(files).toHaveLength(1);
  });
});
