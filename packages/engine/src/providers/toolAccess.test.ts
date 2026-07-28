import { describe, expect, it } from 'vitest';
import {
  resolveToolAccess,
  parseMcpServerNames,
  claudeAllowedToolsArg,
  applyReadOnlyToolArgs
} from './toolAccess.js';

describe('resolveToolAccess', () => {
  it('always confines safe-mode agents to read-only tools', () => {
    expect(resolveToolAccess('read-only', 'safe')).toBe('read-only');
    expect(resolveToolAccess('read-only', 'dangerous')).toBe('read-only');
    expect(resolveToolAccess('none', 'safe')).toBe('read-only');
    expect(resolveToolAccess(undefined, 'safe')).toBe('read-only');
  });
});

describe('parseMcpServerNames', () => {
  it('extracts server names from mcp config json', () => {
    const raw = JSON.stringify({ mcpServers: { search: { command: 'npx' }, fs: { command: 'node' } } });
    expect(parseMcpServerNames(raw)).toEqual(['search', 'fs']);
  });

  it('returns empty for missing, invalid, or empty config', () => {
    expect(parseMcpServerNames(null)).toEqual([]);
    expect(parseMcpServerNames('not json')).toEqual([]);
    expect(parseMcpServerNames('{"mcpServers": null}')).toEqual([]);
    expect(parseMcpServerNames('{}')).toEqual([]);
  });
});

describe('claudeAllowedToolsArg', () => {
  it('joins only the read-only builtins and excludes mcp server entries', () => {
    expect(claudeAllowedToolsArg(['search']))
      .toBe('Read,Grep,Glob,LS,WebSearch,WebFetch');
  });

  it('is builtins-only without mcp servers', () => {
    expect(claudeAllowedToolsArg([])).toBe('Read,Grep,Glob,LS,WebSearch,WebFetch');
  });
});

describe('applyReadOnlyToolArgs', () => {
  it('forces plan mode and appends the Claude read-only tool allowlist', () => {
    expect(applyReadOnlyToolArgs('claude', ['-p', '--verbose'], []))
      .toEqual([
        '-p',
        '--verbose',
        '--permission-mode',
        'plan',
        '--allowedTools',
        'Read,Grep,Glob,LS,WebSearch,WebFetch'
      ]);
  });

  it('swaps the codex sandbox to read-only', () => {
    expect(applyReadOnlyToolArgs('codex', ['exec', '--sandbox', 'workspace-write'], []))
      .toEqual(['exec', '--sandbox', 'read-only']);
  });

  it('leaves other presets untouched', () => {
    expect(applyReadOnlyToolArgs('gemini', ['--output-format', 'stream-json'], []))
      .toEqual(['--output-format', 'stream-json']);
    expect(applyReadOnlyToolArgs('none', ['custom'], [])).toEqual(['custom']);
  });

  it('does not mutate the input array', () => {
    const args = ['exec', '--sandbox', 'workspace-write'];
    applyReadOnlyToolArgs('codex', args, []);
    expect(args).toEqual(['exec', '--sandbox', 'workspace-write']);
  });
});
