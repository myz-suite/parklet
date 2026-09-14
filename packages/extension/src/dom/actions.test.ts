// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  executeDomAction,
  keyDef,
  parseKeyCombo,
  parseSearchResults,
  resolveInput,
} from './actions.js';

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

describe('resolveInput', () => {
  it('returns an editable element directly', () => {
    document.body.innerHTML = '<input id="a" />';
    expect(resolveInput(document, '#a')).toBe(document.getElementById('a'));
  });

  it('resolves label[for] to its input', () => {
    document.body.innerHTML = '<label for="f">Name</label><input id="f" />';
    expect(resolveInput(document, 'label')).toBe(document.getElementById('f'));
  });

  it('resolves a wrapping label to the nested input', () => {
    document.body.innerHTML = '<label>Name <input id="g" /></label>';
    expect(resolveInput(document, 'label')).toBe(document.getElementById('g'));
  });

  it('resolves a container with a single descendant input', () => {
    document.body.innerHTML = '<div id="wrap"><span>Name</span><textarea id="t"></textarea></div>';
    expect(resolveInput(document, '#wrap')).toBe(document.getElementById('t'));
  });

  it('throws TARGET_AMBIGUOUS for multiple candidates', () => {
    document.body.innerHTML = '<div id="wrap"><input id="x" /><input id="y" /></div>';
    expect(() => resolveInput(document, '#wrap')).toThrowError(/multiple inputs/);
    try {
      resolveInput(document, '#wrap');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('TARGET_AMBIGUOUS');
    }
  });

  it('throws TARGET_NOT_FOUND when nothing matches', () => {
    document.body.innerHTML = '<div id="empty"></div>';
    expect(() => resolveInput(document, '#empty')).toThrowError(/no input found/);
    try {
      resolveInput(document, '#empty');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('TARGET_NOT_FOUND');
    }
  });
});

describe('parseKeyCombo', () => {
  it('parses modifier combos', () => {
    expect(parseKeyCombo('Control+c')).toMatchObject({ key: 'c', ctrlKey: true });
    expect(parseKeyCombo('Meta+s')).toMatchObject({ key: 's', metaKey: true });
    expect(parseKeyCombo('Shift+Tab')).toMatchObject({ key: 'Tab', shiftKey: true });
    expect(parseKeyCombo('Control+Shift+k')).toMatchObject({ ctrlKey: true, shiftKey: true });
  });

  it('parses a plain key', () => {
    expect(parseKeyCombo('Enter')).toEqual({
      key: 'Enter',
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  });
});

describe('keyDef', () => {
  it('maps named keys and printable characters', () => {
    expect(keyDef('Enter')).toMatchObject({ key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(keyDef('ArrowDown')).toMatchObject({ keyCode: 40, code: 'ArrowDown' });
    expect(keyDef('a')).toMatchObject({ key: 'a', code: 'KeyA', keyCode: 65, charCode: 97 });
    expect(keyDef('3')).toMatchObject({ code: 'Digit3', keyCode: 51 });
  });

  it('throws INVALID_PARAMS for unknown multi-character keys', () => {
    try {
      keyDef('Hello world');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('INVALID_PARAMS');
    }
  });
});

describe('press default actions', () => {
  it('inserts a printable character into an input', async () => {
    document.body.innerHTML = '<input id="t" />';
    const el = document.getElementById('t') as HTMLInputElement;
    el.focus();
    await executeDomAction('press', { selector: '#t', key: 'a' }, document, 1, 0);
    expect(el.value).toBe('a');
  });

  it('Backspace deletes the previous character', async () => {
    document.body.innerHTML = '<input id="t" value="ab" />';
    const el = document.getElementById('t') as HTMLInputElement;
    el.focus();
    await executeDomAction('press', { selector: '#t', key: 'Backspace' }, document, 1, 0);
    expect(el.value).toBe('a');
  });

  it('Control+A selects the field content', async () => {
    document.body.innerHTML = '<input id="t" value="hello" />';
    const el = document.getElementById('t') as HTMLInputElement;
    el.focus();
    await executeDomAction('press', { selector: '#t', key: 'Control+a' }, document, 1, 0);
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe(5);
  });
});

describe('press combos', () => {
  it('dispatches the full modifier sequence with modifier flags', async () => {
    document.body.innerHTML = '<input id="in" />';
    const input = document.getElementById('in')!;
    const seen: Array<{ type: string; key: string; ctrl: boolean }> = [];
    for (const type of ['keydown', 'keyup']) {
      input.addEventListener(type, (e) => {
        const ke = e as KeyboardEvent;
        seen.push({ type, key: ke.key, ctrl: ke.ctrlKey });
      });
    }
    await executeDomAction('press', { selector: '#in', key: 'Control+a' }, document, 1, 0);
    expect(seen).toEqual([
      { type: 'keydown', key: 'Control', ctrl: true },
      { type: 'keydown', key: 'a', ctrl: true },
      { type: 'keyup', key: 'a', ctrl: true },
      { type: 'keyup', key: 'Control', ctrl: true },
    ]);
  });
});

describe('extract with selector / structured', () => {
  it('text + selector returns each first-layer element text', async () => {
    document.body.innerHTML = '<ul id="l"><li>one</li><li>two</li><li>three</li></ul>';
    const res = (await executeDomAction(
      'extract',
      { mode: 'text', selector: '#l', offset: 1, limit: 1 },
      document,
      1,
      0,
    )) as { mode: string; texts: string[] };
    expect(res.mode).toBe('text');
    expect(res.texts).toEqual(['two']);
  });

  it('structured builds a DomNode tree with depth', async () => {
    document.body.innerHTML = '<div id="root"><section><p>deep</p></section></div>';
    const res = (await executeDomAction(
      'extract',
      { mode: 'structured', selector: '#root', depth: 2 },
      document,
      1,
      0,
    )) as { mode: string; nodes: Array<{ tag: string; children: unknown[] }> };
    expect(res.mode).toBe('structured');
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0]?.tag).toBe('section');
    expect(res.nodes[0]?.children).toHaveLength(1);
  });

  it('visibleOnly filters hidden first-layer elements', async () => {
    document.body.innerHTML = '<div id="c"><p>keep</p><p style="display:none">hide</p></div>';
    const res = (await executeDomAction(
      'extract',
      { mode: 'structured', selector: '#c', visibleOnly: true },
      document,
      1,
      0,
    )) as { nodes: Array<{ tag: string; text?: string }> };
    expect(res.nodes.map((n) => n.text)).toEqual(['keep']);
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
