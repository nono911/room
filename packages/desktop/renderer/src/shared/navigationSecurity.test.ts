// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  isAllowedExternalUrl,
  isAllowedRendererNavigation
} from '../../../main/navigation-security.js';

describe('Electron navigation policy', () => {
  it('opens only HTTP and HTTPS destinations externally', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true);
    expect(isAllowedExternalUrl('http://localhost:3000')).toBe(true);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('data:text/html,owned')).toBe(false);
    expect(isAllowedExternalUrl('file:///tmp/secret')).toBe(false);
  });

  it('allows only ROOM renderer origins for in-window navigation', () => {
    expect(isAllowedRendererNavigation('app://localhost/index.html', false)).toBe(true);
    expect(isAllowedRendererNavigation('http://localhost:5173/app', true)).toBe(true);
    expect(isAllowedRendererNavigation('http://localhost:5173/app', false)).toBe(false);
    expect(isAllowedRendererNavigation('https://example.com', true)).toBe(false);
  });
});
