// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildDomTree, buildPageSnapshot, extractPage, extractVisibleText } from './snapshot.js';

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

describe('buildDomTree', () => {
  it('truncates at the node budget and flags truncated', () => {
    setup('<div id="r"></div>');
    const root = document.getElementById('r')!;
    for (let i = 0; i < 20; i += 1) {
      const child = document.createElement('span');
      child.textContent = String(i);
      root.append(child);
    }
    const { nodes, truncated } = buildDomTree(Array.from(root.children), 3, 5);
    expect(nodes).toHaveLength(5);
    expect(truncated).toBe(true);
  });

  it('does not flag truncation when under budget', () => {
    setup('<div id="r"><a>1</a><b>2</b></div>');
    const root = document.getElementById('r')!;
    const { nodes, truncated } = buildDomTree(Array.from(root.children), 3, 500);
    expect(nodes).toHaveLength(2);
    expect(truncated).toBe(false);
  });
});

describe('extractPage', () => {
  it('structured returns total and echoes offset/limit', () => {
    setup(`<div id="r">${'<i></i>'.repeat(5)}</div>`);
    const res = extractPage(
      document,
      { mode: 'structured', selector: '#r', offset: 1, limit: 2 },
      1,
      0,
    );
    expect(res.mode).toBe('structured');
    if (res.mode === 'structured') {
      expect(res.total).toBe(5);
      expect(res.offset).toBe(1);
      expect(res.limit).toBe(2);
      expect(res.nodes).toHaveLength(2);
    }
  });

  it('truncates text mode by maxChars', () => {
    setup(`<p>${'a'.repeat(300)}</p>`);
    const res = extractPage(document, { mode: 'text', maxChars: 100 }, 1, 0);
    expect(res.mode).toBe('text');
    if (res.mode === 'text' && 'snapshot' in res) {
      expect(res.snapshot.visibleText.length).toBeLessThan(200);
      expect(res.snapshot.visibleText.endsWith('…')).toBe(true);
    }
  });

  it('html returns outerHTML of matched elements with pagination', () => {
    setup('<ul id="list"><li>a</li><li>b</li><li>c</li></ul>');
    const res = extractPage(
      document,
      { mode: 'html', selector: '#list > li', offset: 1, limit: 1 },
      1,
      0,
    );
    expect(res.mode).toBe('html');
    if (res.mode === 'html') {
      expect(res.total).toBe(3);
      expect(res.offset).toBe(1);
      expect(res.limit).toBe(1);
      expect(res.items).toEqual(['<li>b</li>']);
    }
  });

  it('structured keeps long direct text (no 500-char truncation)', () => {
    setup(`<div id="r"><p>${'x'.repeat(600)}</p></div>`);
    const res = extractPage(document, { mode: 'structured', selector: '#r', depth: 1 }, 1, 0);
    expect(res.mode).toBe('structured');
    if (res.mode === 'structured') {
      const p = res.nodes.find((n) => n.tag === 'p');
      expect(p?.text?.length).toBe(600);
    }
  });

  it('fields extracts text, attributes, absolute URLs and nulls', () => {
    setup(
      '<article class="tweet" data-id="1"><span class="author">Alice</span>' +
        '<a class="link" href="/alice">@alice</a>' +
        '<time datetime="2026-11-03T01:02:03Z">1h</time>' +
        '<p class="text">Hello <b>world</b></p></article>' +
        '<article class="tweet" data-id="2"><span class="author">Bob</span>' +
        '<time datetime="2026-11-03T02:03:04Z">2h</time></article>',
    );
    const res = extractPage(
      document,
      {
        selector: 'article.tweet',
        fields: [
          { name: 'author', selector: '.author' },
          { name: 'link', selector: '.link', attr: 'href' },
          { name: 'datetime', selector: 'time', attr: 'datetime' },
          { name: 'text', selector: '.text' },
          { name: 'missing', selector: '.nope' },
        ],
      },
      1,
      0,
    );
    expect(res.mode).toBe('fields');
    if (res.mode === 'fields') {
      expect(res.total).toBe(2);
      expect(res.items).toEqual([
        {
          author: 'Alice',
          link: 'http://localhost:3000/alice',
          datetime: '2026-11-03T01:02:03Z',
          text: 'Hello world',
          missing: null,
        },
        {
          author: 'Bob',
          link: null,
          datetime: '2026-11-03T02:03:04Z',
          text: null,
          missing: null,
        },
      ]);
    }
  });

  it('fields supports alternatives, pagination and exclude', () => {
    setup(
      '<ul><li><span class="a">A1</span></li><li><span class="b">B2</span></li>' +
        '<li><span class="a">A3</span></li></ul>',
    );
    const res = extractPage(
      document,
      {
        selector: 'li',
        offset: 1,
        limit: 1,
        fields: [{ name: 'value', selector: '.a', alternatives: ['.b'] }],
      },
      1,
      0,
    );
    if (res.mode === 'fields') {
      expect(res.total).toBe(3);
      expect(res.offset).toBe(1);
      expect(res.limit).toBe(1);
      expect(res.items).toEqual([{ value: 'B2' }]);
    }
  });

  it('exclude drops matched elements from text / structured / html', () => {
    setup('<div id="r"><p>keep</p><p class="noise">drop</p></div>');
    const text = extractPage(document, { mode: 'text', selector: '#r', exclude: '.noise' }, 1, 0);
    expect(text.mode).toBe('text');
    if (text.mode === 'text' && 'texts' in text) {
      expect(text.texts.join('')).toBe('keep');
    }
    const st = extractPage(
      document,
      { mode: 'structured', selector: '#r', depth: 1, exclude: '.noise' },
      1,
      0,
    );
    if (st.mode === 'structured') {
      const joined = st.nodes.map((n) => n.text ?? '').join('');
      expect(joined).toContain('keep');
      expect(joined).not.toContain('drop');
    }
    const html = extractPage(document, { mode: 'html', selector: '#r', exclude: '.noise' }, 1, 0);
    if (html.mode === 'html') {
      expect(html.items[0]).toContain('keep');
      expect(html.items[0]).not.toContain('drop');
    }
  });
});
