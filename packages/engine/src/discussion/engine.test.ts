import { describe, expect, it } from 'vitest';
import { safeDocumentSlug, stripExternalFileLinks } from './engine.js';

describe('safeDocumentSlug', () => {
  it('preserves Thai vowels and tone marks in document filenames', () => {
    expect(safeDocumentSlug('ถ้าต้องการเล่น forex ตอนนี้ เทรดยาว 3 เดือน ควรซื้อคู่ไหน')).toBe(
      'ถ้าต้องการเล่น-forex-ตอนนี้-เทรดยาว-3-เดือน-ควรซื้อคู่ไหน'
    );
  });

  it('falls back when the title has no filename-safe characters', () => {
    expect(safeDocumentSlug('!!!')).toBe('discussion');
  });
});

describe('stripExternalFileLinks', () => {
  it('removes file links outside the workspace from provider output', () => {
    const content = stripExternalFileLinks(
      'Saved in [forex_3month_strategy.md](file:///Users/me/.gemini/antigravity-cli/brain/id/forex_3month_strategy.md).',
      '/Users/me/workspace'
    );

    expect(content).toBe('Saved in forex_3month_strategy.md.');
  });

  it('keeps file links inside the workspace', () => {
    const link = 'file:///Users/me/workspace/.room/documents/summary.md';
    expect(stripExternalFileLinks(`[summary](${link})`, '/Users/me/workspace')).toBe(`[summary](${link})`);
  });

  it('redacts bare file urls outside the workspace', () => {
    const content = stripExternalFileLinks(
      'See file:///Users/me/.gemini/antigravity-cli/brain/id/notes.md for details.',
      '/Users/me/workspace'
    );

    expect(content).toBe('See [external file path removed] for details.');
  });
});
