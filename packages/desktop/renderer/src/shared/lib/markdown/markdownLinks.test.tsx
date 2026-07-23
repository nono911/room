import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown } from './MarkdownContent.js';
import { normalizeSafeMarkdownHref } from './markdownLinks.js';

describe('Markdown link safety', () => {
  it('allows only explicit HTTP and HTTPS destinations', () => {
    expect(normalizeSafeMarkdownHref('https://example.com/report')).toBe('https://example.com/report');
    expect(normalizeSafeMarkdownHref('http://localhost:3000/path')).toBe('http://localhost:3000/path');
    expect(normalizeSafeMarkdownHref('javascript:alert(1)')).toBeNull();
    expect(normalizeSafeMarkdownHref('data:text/html,owned')).toBeNull();
    expect(normalizeSafeMarkdownHref('custom:open')).toBeNull();
    expect(normalizeSafeMarkdownHref('java\u0000script:alert(1)')).toBeNull();
    expect(normalizeSafeMarkdownHref('/relative/path')).toBeNull();
  });

  it('renders unsafe Markdown destinations as inert text', () => {
    render(<div>{renderInlineMarkdown('[Open report](javascript:alert(1))')}</div>);
    expect(screen.getByText('Open report').tagName).toBe('SPAN');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps safe external links clickable', () => {
    render(<div>{renderInlineMarkdown('[Open report](https://example.com/report)')}</div>);
    const link = screen.getByRole('link', { name: 'Open report' });
    expect(link.getAttribute('href')).toBe('https://example.com/report');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
