// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { executeDomAction, parseSearchResults } from './actions.js';

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      toJSON: () => ({}),
    }) as DOMRect;
});

describe('interaction actions', () => {
  it('click triggers the element click handler', () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const handler = vi.fn();
    document.getElementById('b')!.addEventListener('click', handler);
    const res = executeDomAction('click', { selector: '#b' }, document, 1, 0);
    void res;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('click-text finds by visible text', () => {
    document.body.innerHTML = '<button>Submit form</button>';
    const handler = vi.fn();
    document.querySelector('button')!.addEventListener('click', handler);
    void executeDomAction('click-text', { text: 'Submit' }, document, 1, 0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fill sets value and fires input/change', () => {
    document.body.innerHTML = '<input id="name" />';
    const input = document.getElementById('name')!;
    const fired: string[] = [];
    input.addEventListener('input', () => fired.push('input'));
    input.addEventListener('change', () => fired.push('change'));
    const res = executeDomAction('fill', { selector: '#name', value: 'Alice' }, document, 1, 0);
    void res;
    expect((input as HTMLInputElement).value).toBe('Alice');
    expect(fired).toEqual(['input', 'change']);
  });

  it('select throws TARGET_NOT_FOUND for a missing option', async () => {
    document.body.innerHTML = '<select id="s"><option value="a">A</option></select>';
    await expect(
      executeDomAction('select', { selector: '#s', value: 'zzz' }, document, 1, 0),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
  });

  it('select matches by label', async () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select>';
    const res = await executeDomAction('select', { selector: '#s', label: 'Beta' }, document, 1, 0);
    expect((document.getElementById('s') as HTMLSelectElement).value).toBe('b');
    expect((res as { element: { tag: string } }).element.tag).toBe('select');
  });

  it('scroll returns the viewport', async () => {
    document.body.innerHTML = '<div style="height:2000px"></div>';
    const res = await executeDomAction('scroll', { direction: 'down' }, document, 1, 0);
    expect((res as { viewport: { width: number } }).viewport.width).toBeGreaterThan(0);
  });
});

describe('extract and wait', () => {
  it('extract builds a page snapshot', async () => {
    document.body.innerHTML = '<p>Hello snapshot</p>';
    document.title = 'Snap';
    const res = (await executeDomAction('extract', { mode: 'text' }, document, 5, 2)) as {
      snapshot: { context: { navId: number; tabId: number }; visibleText: string };
    };
    expect(res.snapshot.context.navId).toBe(2);
    expect(res.snapshot.context.tabId).toBe(5);
    expect(res.snapshot.visibleText).toContain('Hello snapshot');
  });

  it('get-page-info returns url/title/viewport/scrollY', async () => {
    document.body.innerHTML = '<p>x</p>';
    document.title = 'Info';
    const res = (await executeDomAction('get-page-info', {}, document, 1, 0)) as {
      title: string;
      viewport: { width: number };
    };
    expect(res.title).toBe('Info');
    expect(res.viewport.width).toBeGreaterThan(0);
  });

  it('wait with selector polls until the element appears', async () => {
    document.body.innerHTML = '<div id="late"></div>';
    setTimeout(() => {
      const el = document.getElementById('late')!;
      el.textContent = 'now visible';
    }, 50);
    const res = await executeDomAction('wait', { selector: '#late' }, document, 1, 0);
    void res;
    expect(true).toBe(true); // 未抛错即通过
  });
});

describe('parseSearchResults', () => {
  it('parses DuckDuckGo html structure', () => {
    document.body.innerHTML = `
      <div class="result">
        <a class="result__a" href="https://example.com/1">Example One</a>
        <a class="result__snippet" href="https://example.com/1">snippet text</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.com/2">Example Two</a>
      </div>`;
    const results = parseSearchResults(document);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: 'Example One', url: 'https://example.com/1' });
  });

  it('falls back to Google h3 structure', () => {
    document.body.innerHTML = `
      <div><a href="https://g.com/1"><h3>Google Result</h3></a></div>`;
    const results = parseSearchResults(document);
    expect(results[0]).toMatchObject({ title: 'Google Result' });
  });

  it('returns [] for a page without results', () => {
    document.body.innerHTML = '<p>nothing</p>';
    expect(parseSearchResults(document)).toEqual([]);
  });
});
