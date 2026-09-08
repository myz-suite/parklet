// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildPageSnapshot, extractVisibleText } from './snapshot.js';

function setup(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('extractVisibleText', () => {
  it('extracts body text and excludes script/style', () => {
    setup(
      '<h1>Title</h1><p>Hello <b>world</b></p><script>window.__x = 1;</script><style>.a{}</style>',
    );
    const text = extractVisibleText(document);
    expect(text).toContain('Title');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).not.toContain('__x');
    expect(text).not.toContain('.a{}');
  });

  it('respects the char limit with a truncation marker', () => {
    setup(`<p>${'a'.repeat(500)}</p>`);
    const text = extractVisibleText(document, 100);
    expect(text.length).toBeLessThan(200);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('buildPageSnapshot', () => {
  it('carries context and viewport', () => {
    setup('<p>content</p>');
    document.title = 'My Page';
    const snap = buildPageSnapshot(document, 7, 3);
    expect(snap.context.url).toBe('http://localhost:3000/');
    expect(snap.context.title).toBe('My Page');
    expect(snap.context.navId).toBe(3);
    expect(snap.context.tabId).toBe(7);
    expect(snap.viewport.width).toBeGreaterThan(0);
    expect(snap.visibleText).toContain('content');
  });
});
