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

  it('scroll --by returns before/after/delta', async () => {
    document.body.innerHTML = '<div style="height:2000px"></div>';
    const originalY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    const originalScrollBy = (window as unknown as { scrollBy?: unknown }).scrollBy;
    let y = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    (window as unknown as { scrollBy: (o: ScrollToOptions) => void }).scrollBy = (o) => {
      y += Number(o.top ?? 0);
    };
    try {
      const res = (await executeDomAction(
        'scroll',
        { by: 850, settle: false },
        document,
        1,
        0,
      )) as {
        before: { y: number };
        after: { y: number };
        delta: { y: number };
      };
      expect(res.before.y).toBe(0);
      expect(res.after.y).toBe(850);
      expect(res.delta.y).toBe(850);
    } finally {
      if (originalY !== undefined) Object.defineProperty(window, 'scrollY', originalY);
      if (originalScrollBy !== undefined) {
        (window as unknown as { scrollBy: unknown }).scrollBy = originalScrollBy;
      }
    }
  });

  it('scroll settle completes when the document is hidden', async () => {
    document.body.innerHTML = '<div style="height:2000px"></div>';
    const originalScrollBy = (window as unknown as { scrollBy?: unknown }).scrollBy;
    const originalY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    let y = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    (window as unknown as { scrollBy: (o: ScrollToOptions) => void }).scrollBy = (o) => {
      y += Number(o.top ?? 0);
    };
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      const started = Date.now();
      const res = (await executeDomAction('scroll', { by: 100 }, document, 1, 0)) as {
        warning?: string;
        settled?: boolean;
      };
      expect(res.warning).toBe('BACKGROUND_TAB');
      expect(res.settled).toBe(true);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
      if (originalY !== undefined) Object.defineProperty(window, 'scrollY', originalY);
      if (originalScrollBy !== undefined) {
        (window as unknown as { scrollBy: unknown }).scrollBy = originalScrollBy;
      }
    }
  });

  it('scroll with no effect reports NO_EFFECT', async () => {
    document.body.innerHTML = '<div style="height:2000px"></div>';
    const originalScrollBy = (window as unknown as { scrollBy?: unknown }).scrollBy;
    (window as unknown as { scrollBy: (o: ScrollToOptions) => void }).scrollBy = () => {};
    try {
      await expect(
        executeDomAction('scroll', { by: 100, settle: false }, document, 1, 0),
      ).rejects.toMatchObject({ code: 'NO_EFFECT' });
      const allowed = (await executeDomAction(
        'scroll',
        { by: 100, settle: false, allowNoop: true },
        document,
        1,
        0,
      )) as { delta: { y: number } };
      expect(allowed.delta.y).toBe(0);
    } finally {
      if (originalScrollBy !== undefined) {
        (window as unknown as { scrollBy: unknown }).scrollBy = originalScrollBy;
      }
    }
  });

  it('scroll reports BACKGROUND_TAB when the document is hidden', async () => {
    document.body.innerHTML = '<div style="height:2000px"></div>';
    const originalScrollBy = (window as unknown as { scrollBy?: unknown }).scrollBy;
    const originalY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    let y = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    (window as unknown as { scrollBy: (o: ScrollToOptions) => void }).scrollBy = (o) => {
      y += Number(o.top ?? 0);
    };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    try {
      const res = (await executeDomAction(
        'scroll',
        { by: 100, settle: false },
        document,
        1,
        0,
      )) as { warning?: string; visibilityState?: string };
      expect(res.visibilityState).toBe('hidden');
      expect(res.warning).toBe('BACKGROUND_TAB');
    } finally {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
      if (originalY !== undefined) Object.defineProperty(window, 'scrollY', originalY);
      if (originalScrollBy !== undefined) {
        (window as unknown as { scrollBy: unknown }).scrollBy = originalScrollBy;
      }
    }
  });

  it('scroll with a selector returns the element delta', async () => {
    document.body.innerHTML = '<div id="box" style="height:100px;overflow:auto"></div>';
    const box = document.getElementById('box')! as HTMLElement;
    let top = 0;
    Object.defineProperty(box, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 100 });
    (box as unknown as { scrollBy: (o: ScrollToOptions) => void }).scrollBy = (o) => {
      top += Number(o.top ?? 0);
    };
    const res = (await executeDomAction(
      'scroll',
      { selector: '#box', by: 300, settle: false },
      document,
      1,
      0,
    )) as {
      target: { selector: string };
      delta: { y: number };
    };
    expect(res.target.selector).toBe('#box');
    expect(res.delta.y).toBe(300);
  });

  it('scroll-to brings the element into view and reports post-scroll box', async () => {
    document.body.innerHTML = '<div id="target">T</div>';
    const el = document.getElementById('target')!;
    let top = 0;
    el.getBoundingClientRect = () =>
      ({
        x: 0,
        y: top,
        width: 100,
        height: 20,
        top,
        left: 0,
        right: 100,
        bottom: top + 20,
        toJSON: () => ({}),
      }) as DOMRect;
    const spy = vi.fn(() => {
      top = 100;
    });
    (el as unknown as { scrollIntoView: () => void }).scrollIntoView = spy;
    const res = (await executeDomAction(
      'scroll-to',
      { selector: '#target', settle: false },
      document,
      1,
      0,
    )) as {
      element?: { tag?: string; box?: { y: number } };
    };
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.element?.tag).toBe('div');
    expect(res.element?.box?.y).toBe(100);
  });

  it('dom-query returns matches with tag/class/text and total', async () => {
    document.body.innerHTML =
      '<div class="a">one</div><div class="a">two</div><div class="b">three</div>';
    const res = (await executeDomAction('dom-query', { selector: '.a' }, document, 1, 0)) as {
      matches: Array<{ tag: string; class?: string; text?: string }>;
      total: number;
    };
    expect(res.total).toBe(2);
    expect(res.matches[0]).toMatchObject({ tag: 'div', class: 'a', text: 'one' });
  });

  it('dom-query by visible text returns the best match', async () => {
    document.body.innerHTML = '<button id="go">Sign in</button>';
    const res = (await executeDomAction('dom-query', { text: 'Sign in' }, document, 1, 0)) as {
      matches: Array<{ tag: string; id?: string }>;
      total: number;
    };
    expect(res.total).toBe(1);
    expect(res.matches[0]).toMatchObject({ tag: 'button', id: 'go' });
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

  it('wait with count/stable polls until the count is stable', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const timer = setTimeout(() => {
      for (let i = 0; i < 3; i += 1) {
        const el = document.createElement('div');
        el.className = 'late';
        host.appendChild(el);
      }
    }, 50);
    try {
      const res = (await executeDomAction(
        'wait',
        { selector: '.late', count: 3, stableMs: 100 },
        document,
        1,
        0,
      )) as { matched?: number; stable?: boolean };
      expect(res.matched).toBe(3);
      expect(res.stable).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  it('wait with selector polls until the element appears', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const timer = setTimeout(() => {
      const el = document.createElement('div');
      el.id = 'late';
      document.getElementById('host')?.appendChild(el);
    }, 50);
    try {
      const res = await executeDomAction('wait', { selector: '#late' }, document, 1, 0);
      void res;
      expect(document.getElementById('late')).not.toBeNull();
    } finally {
      clearTimeout(timer);
    }
  });
});

describe('selection', () => {
  it('selects an element by CSS selector and returns its text', async () => {
    document.body.innerHTML = '<p id="p">hello world</p>';
    const res = (await executeDomAction('selection', { selector: '#p' }, document, 1, 0)) as {
      text?: string;
    };
    expect(res.text).toBe('hello world');
  });

  it('selects an element by visible text', async () => {
    document.body.innerHTML = '<div><span>Pick me</span></div>';
    const res = (await executeDomAction('selection', { text: 'Pick me' }, document, 1, 0)) as {
      text?: string;
    };
    expect(res.text).toBe('Pick me');
  });

  it('selects all text in an input and returns its value', async () => {
    document.body.innerHTML = '<input id="i" value="abc" />';
    const res = (await executeDomAction('selection', { selector: '#i' }, document, 1, 0)) as {
      text?: string;
    };
    expect(res.text).toBe('abc');
  });

  it('rejects ambiguous visible text', async () => {
    document.body.innerHTML = '<span>same</span><span>same</span>';
    await expect(
      executeDomAction('selection', { text: 'same' }, document, 1, 0),
    ).rejects.toMatchObject({ code: 'TARGET_AMBIGUOUS' });
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

  it('extracts a Google snippet when present', () => {
    document.body.innerHTML = `
      <div>
        <a href="https://g.com/1"><h3>Title One</h3></a>
        <div class="VwiC3b">A short summary.</div>
      </div>`;
    const results = parseSearchResults(document);
    expect(results[0]).toMatchObject({ title: 'Title One', snippet: 'A short summary.' });
  });

  it('falls back to the longest non-title text block for a Google snippet', () => {
    document.body.innerHTML = `
      <div>
        <a href="https://g.com/1"><h3>Title One</h3></a>
        <div>This is a longer descriptive sentence for the result.</div>
      </div>`;
    const results = parseSearchResults(document);
    expect(results[0]!.snippet).toBe('This is a longer descriptive sentence for the result.');
  });

  it('returns [] for a page without results', () => {
    document.body.innerHTML = '<p>nothing</p>';
    expect(parseSearchResults(document)).toEqual([]);
  });
});
