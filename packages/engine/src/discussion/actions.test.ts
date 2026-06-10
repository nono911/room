import { describe, it, expect } from 'vitest';
import { parseModeratorActions, stripActionBlocks } from './actions.js';

describe('parseModeratorActions', () => {
  it('parses a single create_task block', () => {
    const content = 'Verdict text.\n\n```room-action\n{"action": "create_task", "title": "Build login", "kind": "task"}\n```';
    const result = parseModeratorActions(content);
    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([
      { action: 'create_task', title: 'Build login', kind: 'task', details: undefined, parent: undefined }
    ]);
  });

  it('parses multiple blocks including control actions', () => {
    const content = [
      '```room-action',
      '{"action": "continue", "instructions": "Deepen the risk analysis."}',
      '```',
      'Some prose.',
      '```room-action',
      '{"action": "create_adr", "title": "Use SQLite", "context": "Storage layer", "decision": "Adopt SQLite"}',
      '```'
    ].join('\n');
    const result = parseModeratorActions(content);
    expect(result.errors).toEqual([]);
    expect(result.actions).toEqual([
      { action: 'continue', instructions: 'Deepen the risk analysis.' },
      { action: 'create_adr', title: 'Use SQLite', context: 'Storage layer', decision: 'Adopt SQLite' }
    ]);
  });

  it('accepts a JSON array of actions in one block', () => {
    const content = '```room-action\n[{"action": "stop", "reason": "Done"}, {"action": "create_task", "title": "Ship it"}]\n```';
    const result = parseModeratorActions(content);
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toEqual({ action: 'stop', reason: 'Done' });
  });

  it('collects invalid JSON as errors without throwing', () => {
    const content = '```room-action\n{not json}\n```';
    const result = parseModeratorActions(content);
    expect(result.actions).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects create_task without a title', () => {
    const content = '```room-action\n{"action": "create_task"}\n```';
    const result = parseModeratorActions(content);
    expect(result.actions).toEqual([]);
    expect(result.errors[0]).toMatch(/title/);
  });

  it('defaults an unknown kind to task and rejects unknown actions', () => {
    const content = [
      '```room-action',
      '{"action": "create_task", "title": "A", "kind": "story"}',
      '```',
      '```room-action',
      '{"action": "delete_everything"}',
      '```'
    ].join('\n');
    const result = parseModeratorActions(content);
    expect(result.actions).toEqual([
      { action: 'create_task', title: 'A', kind: 'task', details: undefined, parent: undefined }
    ]);
    expect(result.errors).toHaveLength(1);
  });

  it('returns empty results when there are no blocks', () => {
    expect(parseModeratorActions('Just a verdict, no actions.')).toEqual({ actions: [], errors: [] });
  });
});

describe('stripActionBlocks', () => {
  it('removes action blocks and collapses extra blank lines', () => {
    const content = 'Before.\n\n```room-action\n{"action": "stop"}\n```\n\nAfter.';
    expect(stripActionBlocks(content)).toBe('Before.\n\nAfter.');
  });

  it('returns trimmed content unchanged when no blocks exist', () => {
    expect(stripActionBlocks('  Hello.  ')).toBe('Hello.');
  });

  it('does not collapse extra newlines inside non-room-action code blocks', () => {
    const content = 'Before.\n\n```typescript\nconst a = 1;\n\n\nconst b = 2;\n```\n\nAfter.';
    expect(stripActionBlocks(content)).toBe('Before.\n\n```typescript\nconst a = 1;\n\n\nconst b = 2;\n```\n\nAfter.');
  });
});
