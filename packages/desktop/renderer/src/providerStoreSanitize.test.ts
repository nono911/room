// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readProvidersFromDisk,
  sanitizeProviderEntry
} from '../../main/ipc/provider-store.js';

describe('sanitizeProviderEntry security revision handling', () => {
  const legacyEntry = {
    id: 'custom',
    label: 'Custom',
    kind: 'openai-compatible',
    baseUrl: 'https://example.test/v1'
  };

  it('derives one stable revision for an entry saved before revisions existed', () => {
    // Minting a fresh token per read would never persist, so a machine-skill
    // grant approved against one read could never match the next.
    const first = sanitizeProviderEntry(legacyEntry);
    const second = sanitizeProviderEntry(legacyEntry);

    expect(first?.securityRevision).toMatch(/^[a-f0-9]{32}$/);
    expect(second?.securityRevision).toBe(first?.securityRevision);
  });

  it('rotates the derived revision when the endpoint or credential changes', () => {
    const base = sanitizeProviderEntry(legacyEntry)?.securityRevision;

    expect(sanitizeProviderEntry({
      ...legacyEntry,
      baseUrl: 'https://attacker.test/v1'
    })?.securityRevision).not.toBe(base);
    expect(sanitizeProviderEntry({
      ...legacyEntry,
      apiKey: 'added-later'
    })?.securityRevision).not.toBe(base);
  });

  it('derives a revision rather than trusting a malformed one', () => {
    expect(sanitizeProviderEntry({
      ...legacyEntry,
      securityRevision: 'not-a-real-revision'
    })?.securityRevision).toMatch(/^[a-f0-9]{32}$/);
  });

  it('accepts an entry with a well-formed securityRevision', () => {
    expect(sanitizeProviderEntry({
      id: 'custom',
      label: 'Custom',
      kind: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      securityRevision: 'a'.repeat(32)
    })).toMatchObject({ id: 'custom', securityRevision: 'a'.repeat(32) });
  });

  it('opens a registry written before revisions existed and resolves it identically every read', async () => {
    const roomHome = await fs.mkdtemp(path.join(os.tmpdir(), 'room-provider-revision-'));
    try {
      await readProvidersFromDisk(roomHome, false);
      const providersPath = path.join(roomHome, 'system', 'providers.json');
      const parsed = JSON.parse(await fs.readFile(providersPath, 'utf-8'));
      // Exactly what a registry written by the previous release looks like:
      // no entry carries a securityRevision at all.
      for (const provider of parsed.providers) delete provider.securityRevision;
      await fs.writeFile(providersPath, JSON.stringify(parsed), 'utf-8');

      const first = await readProvidersFromDisk(roomHome, false);
      const second = await readProvidersFromDisk(roomHome, false);

      expect(first).toHaveLength(parsed.providers.length);
      expect(first.map(entry => entry.securityRevision))
        .toEqual(second.map(entry => entry.securityRevision));
      expect(first.every(entry => /^[a-f0-9]{32}$/.test(entry.securityRevision || '')))
        .toBe(true);
    } finally {
      await fs.rm(roomHome, { recursive: true, force: true });
    }
  });
});

describe('local-service probe timer cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clears the probe abort timer on the common connection-refused path', async () => {
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch').mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    );
    const roomHome = await fs.mkdtemp(path.join(os.tmpdir(), 'room-provider-probe-'));
    try {
      await readProvidersFromDisk(roomHome);
      // Each rejected probe must have cleared its 800ms abort timer instead of
      // leaving it scheduled — a leaked timer here keeps the process (and any
      // test runner watching open handles) alive.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await fs.rm(roomHome, { recursive: true, force: true });
    }
  });
});
