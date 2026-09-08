import { describe, expect, it } from 'vitest';
import { buildSearchUrl } from './searchUrl.js';

describe('buildSearchUrl', () => {
  it('builds a google page-1 URL by default (no engine specified)', () => {
    expect(buildSearchUrl('hello world', undefined)).toBe(
      'https://www.google.com/search?q=hello%20world',
    );
    expect(buildSearchUrl('hello', 'google')).toBe('https://www.google.com/search?q=hello');
  });

  it('offsets google by 10 per page from page 2', () => {
    expect(buildSearchUrl('hello', 'google', 2)).toBe(
      'https://www.google.com/search?q=hello&start=10',
    );
    expect(buildSearchUrl('hello', 'google', 5)).toBe(
      'https://www.google.com/search?q=hello&start=40',
    );
  });

  it('builds a duckduckgo page-1 URL without offset', () => {
    expect(buildSearchUrl('hello', 'duckduckgo')).toBe('https://html.duckduckgo.com/html/?q=hello');
  });

  it('offsets duckduckgo by 30 per page from page 2', () => {
    expect(buildSearchUrl('hello', 'duckduckgo', 2)).toBe(
      'https://html.duckduckgo.com/html/?q=hello&s=30',
    );
  });

  it('clamps non-positive and fractional pages to page 1', () => {
    expect(buildSearchUrl('x', undefined, 0)).toBe('https://www.google.com/search?q=x');
    expect(buildSearchUrl('x', 'duckduckgo', -3)).toBe('https://html.duckduckgo.com/html/?q=x');
    expect(buildSearchUrl('x', 'google', 1.9)).toBe('https://www.google.com/search?q=x');
  });
});
