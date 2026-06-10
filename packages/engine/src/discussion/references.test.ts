import { describe, it, expect } from 'vitest';
import { parseMessageReferences } from './references.js';

describe('parseMessageReferences', () => {
  it('extracts references and strips the block from content', () => {
    const content = 'My answer builds on the research.\n\n```room-refs\n{"references": [{"author": "Researcher", "reason": "market sizing data"}]}\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([{ author: 'Researcher', reason: 'market sizing data' }]);
    expect(result.cleaned).toBe('My answer builds on the research.');
  });

  it('accepts a bare array form', () => {
    const content = 'Text.\n```room-refs\n[{"author": "Writer"}]\n```';
    const result = parseMessageReferences(content);
    expect(result.references).toEqual([{ author: 'Writer', reason: undefined }]);
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

  it('returns content unchanged when there is no block', () => {
    const result = parseMessageReferences('Plain answer.');
    expect(result.references).toEqual([]);
    expect(result.cleaned).toBe('Plain answer.');
  });
});
