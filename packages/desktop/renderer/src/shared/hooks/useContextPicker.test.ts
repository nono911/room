import { describe, expect, it } from 'vitest';
import { filterContextRefsForSource } from './useContextPicker.js';

describe('filterContextRefsForSource', () => {
  const roomRefs = ['workspace:overview', 'document:brief.md'];
  const sourceA = 'source-file:source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:README.md';
  const sourceB = 'source-file:source_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:README.md';

  it('keeps Room refs and only refs for the newly active Source', () => {
    expect(filterContextRefsForSource(
      [...roomRefs, sourceA, sourceB],
      'source_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )).toEqual([...roomRefs, sourceB]);
  });

  it('removes all Source refs when the Room becomes source-less', () => {
    expect(filterContextRefsForSource([...roomRefs, sourceA], undefined))
      .toEqual(roomRefs);
  });

  it('filters a saved Source A context set when applied under Source B', () => {
    const savedSet = [...roomRefs, sourceA];
    expect(filterContextRefsForSource(
      savedSet,
      'source_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )).toEqual(roomRefs);
  });

  it('keeps a saved context set source-less by dropping its Source refs', () => {
    const savedSet = [...roomRefs, sourceA];
    expect(filterContextRefsForSource(savedSet)).toEqual(roomRefs);
  });
});
