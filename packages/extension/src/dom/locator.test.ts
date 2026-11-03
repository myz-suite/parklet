// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { findByCss, findByText, isVisible } from './locator.js';

// happy-dom 默认 getBoundingClientRect 返回 0x0，会让所有元素"不可见"。
// 测试中统一返回非零尺寸以模拟可见布局。
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

function setup(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('isVisible', () => {
  it('treats display:none and hidden elements as invisible', () => {
    setup('<div id="a">x</div><div id="b" style="display:none">y</div><div id="c" hidden>z</div>');
    expect(isVisible(document.getElementById('a')!)).toBe(true);
    expect(isVisible(document.getElementById('b')!)).toBe(false);
    expect(isVisible(document.getElementById('c')!)).toBe(false);
  });
});

describe('findByCss', () => {
  it('finds an element by selector and builds ElementInfo', () => {
    setup('<button id="go" class="btn" data-x="1">Submit</button>');
    const { element, info } = findByCss(document, '#go');
    expect(element.id).toBe('go');
    expect(info.tag).toBe('button');
    expect(info.attrs.id).toBe('go');
    expect(info.text).toBe('Submit');
  });

  it('throws TARGET_NOT_FOUND for missing selector', () => {
    setup('<div></div>');
    expect(() => findByCss(document, '#missing')).toThrowError(/no element matches/);
    try {
      findByCss(document, '#missing');
    } catch (err) {
      expect((err as Error & { code?: string }).code).toBe('TARGET_NOT_FOUND');
    }
  });
});

describe('findByText', () => {
  it('finds a visible element containing the text', () => {
    setup('<nav><a href="/a">Installation guide</a></nav><main><p>Other content</p></main>');
    const { element } = findByText(document, 'Installation');
    expect(element.textContent).toContain('Installation');
  });

  it('throws TARGET_NOT_FOUND when no element matches', () => {
    setup('<p>nothing here</p>');
    expect(() => findByText(document, 'ghost')).toThrowError(/no visible element/);
  });

  it('throws TARGET_AMBIGUOUS when multiple equally specific matches exist', () => {
    setup('<div class="r"><a>Same label</a></div><div class="r"><a>Same label</a></div>');
    try {
      findByText(document, 'Same label');
    } catch (err) {
      expect((err as Error & { code?: string }).code).toBe('TARGET_AMBIGUOUS');
    }
  });

  it('ignores script/style content', () => {
    setup(
      '<div><p>Visible text</p><script>var hidden = "Visible text inside script";</script></div>',
    );
    const { element } = findByText(document, 'Visible text');
    expect(element.tagName.toLowerCase()).toBe('p');
  });

  it('actionableOnly ignores matching text containers', () => {
    setup(
      '<p>Following this thread is useful</p><button id="follow">Following</button>' +
        '<p>Following</p>',
    );
    const { element } = findByText(document, 'Following', { actionableOnly: true });
    expect(element.id).toBe('follow');
  });

  it('actionableOnly reports ambiguity between multiple buttons', () => {
    setup('<button id="a">Same</button><button id="b">Same</button>');
    expect(() => findByText(document, 'Same', { actionableOnly: true })).toThrowError(
      /multiple elements/,
    );
  });

  it('actionableOnly rejects pure text', () => {
    setup('<p>Only text</p>');
    expect(() => findByText(document, 'Only text', { actionableOnly: true })).toThrowError(
      /no actionable/,
    );
  });

  it('deduplicates candidates from nested within roots', () => {
    setup('<div id="outer"><div id="inner"><button id="only">Save</button></div></div>');
    const { element } = findByText(document, 'Save', {
      within: 'div',
      actionableOnly: true,
    });
    expect(element.id).toBe('only');
  });

  it('supports within, exact, role and nth', () => {
    setup(
      '<div id="scope"><button id="a">Open</button><button id="b">Open file</button></div>' +
        '<button id="outside">Open</button>',
    );
    const within = findByText(document, 'Open', {
      actionableOnly: true,
      within: '#scope',
    });
    expect(within.element.id).toBe('a');
    const exact = findByText(document, 'Open', {
      actionableOnly: true,
      within: '#scope',
      exact: true,
    });
    expect(exact.element.id).toBe('a');
    const nth = findByText(document, 'Open', {
      actionableOnly: true,
      within: '#scope',
      nth: 1,
    });
    expect(nth.element.id).toBe('b');
    const role = findByText(document, 'Open', {
      actionableOnly: true,
      within: '#scope',
      role: 'button',
      nth: 1,
    });
    expect(role.element.id).toBe('b');
  });
});
