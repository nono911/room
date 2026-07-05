import { describe, it, expect } from 'vitest';
import { parseMessageReferences, shortMessageRef } from './references.js';

describe('parseMessageReferences', () => {
  it('extracts references and strips the block from content', () => {
    const content = 'My answer builds on the research.\n\n```room-refs\n{"references": [{"message": 2, "author": "Researcher", "reason": "market sizing data"}]}\n```';
    const result = parseMessageReferences(content, [
      { promptNumber: 2, id: 'discussion-1:message-0004', agentName: 'Researcher' }
    ]);
    expect(result.references).toEqual([{
      message: 2,
      messageId: 'discussion-1:message-0004',
      author: 'Researcher',
      reason: 'market sizing data'
    }]);
    expect(result.cleaned).toBe('My answer builds on the research.');
  });

  it('accepts a bare array form', () => {
    const content = 'Text.\n```room-refs\n[{"message": 1}]\n```';
    const result = parseMessageReferences(content, [
      { promptNumber: 1, id: 'discussion-1:message-0002', agentName: 'Writer' }
    ]);
    expect(result.references).toEqual([{
      message: 1,
      messageId: 'discussion-1:message-0002',
      author: 'Writer',
      reason: undefined
    }]);
  });

  it('ignores malformed JSON but still strips the block', () => {
    const content = 'Text.\n```room-refs\n{oops}\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([]);
    expect(result.cleaned).toBe('Text.');
  });

  it('skips entries without an author', () => {
    const content = '```room-refs\n{"references": [{"reason": "no author"}, {"author": "Editor"}]}\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([{ author: 'Editor', reason: undefined }]);
  });

  it('does not resolve message numbers outside the provided prompt context', () => {
    const content = '```room-refs\n{"references": [{"message": 4, "reason": "not visible"}]}\n```';
    const result = parseMessageReferences(content, [
      { promptNumber: 1, id: 'discussion-1:message-0012', agentName: 'Architect' }
    ]);
    expect(result.references).toEqual([]);
  });

  it('falls back to an author-only reference when the cited number does not resolve', () => {
    const content = '```room-refs\n{"references": [{"message": 9, "author": "Architect", "reason": "cache shape"}]}\n```';
    const result = parseMessageReferences(content, [
      { promptNumber: 1, id: 'discussion-1:message-0012', agentName: 'Architect' }
    ]);
    expect(result.references).toEqual([{ author: 'Architect', reason: 'cache shape' }]);
  });

  it('returns content unchanged when there is no block', () => {
    const result = parseMessageReferences('Plain answer.');
    expect(result.references).toEqual([]);
    expect(result.cleaned).toBe('Plain answer.');
  });
});

describe('shortMessageRef', () => {
  it('shortens a stable message id', () => {
    expect(shortMessageRef('discussion-1:message-0007')).toBe('m0007');
  });

  it('returns empty for missing or unrecognized ids', () => {
    expect(shortMessageRef(undefined)).toBe('');
    expect(shortMessageRef('something-else')).toBe('');
  });
});

describe('parseMessageReferences with short ids', () => {
  const context = [
    { promptNumber: 1, id: 'discussion-1:message-0002', agentName: 'You' },
    { promptNumber: 2, id: 'discussion-1:message-0007', agentName: 'Architect' }
  ];

  it('resolves an id-based reference to the full message id', () => {
    const content = 'Reply.\n```room-refs\n{"references": [{"id": "m0007", "reason": "built on it"}]}\n```';
    const { references } = parseMessageReferences(content, context);
    expect(references).toEqual([
      { messageId: 'discussion-1:message-0007', author: 'Architect', reason: 'built on it' }
    ]);
  });

  it('prefers id resolution over a mismatched message number', () => {
    const content = 'Reply.\n```room-refs\n{"references": [{"id": "m0002", "message": 2, "reason": "r"}]}\n```';
    const { references } = parseMessageReferences(content, context);
    expect(references[0].messageId).toBe('discussion-1:message-0002');
    expect(references[0].author).toBe('You');
  });

  it('still resolves legacy number-only references', () => {
    const content = 'Reply.\n```room-refs\n{"references": [{"message": 2, "author": "Architect", "reason": "r"}]}\n```';
    const { references } = parseMessageReferences(content, context);
    expect(references[0].messageId).toBe('discussion-1:message-0007');
  });
});
