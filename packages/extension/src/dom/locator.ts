import type { ElementBox, ElementInfo } from '@parklet/protocol';

/**
 * 定位器：CSS 选择器与可见文本（v1）。
 * 纯 DOM 逻辑，可在 happy-dom 环境下测试。
 */

export interface Located {
  element: Element;
  info: ElementInfo;
}

export function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (htmlEl.hidden) return false;
  const style = window.getComputedStyle(el);
  // happy-dom 的 getComputedStyle 不反映 inline style，这里显式兜底；
  // 注意未设置时为 ''，不能参与比较（Number('') === 0 会误判 opacity）
  const inline = htmlEl.style;
  const set = (v: string) => v !== '';
  if (set(style.display) && style.display === 'none') return false;
  if (set(inline.display) && inline.display === 'none') return false;
  if (set(style.visibility) && style.visibility === 'hidden') return false;
  if (set(inline.visibility) && inline.visibility === 'hidden') return false;
  if (set(style.opacity) && Number(style.opacity) === 0) return false;
  if (set(inline.opacity) && Number(inline.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function toElementInfo(el: Element): ElementInfo {
  const rect = el.getBoundingClientRect();
  const box: ElementBox = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value;
  }
  return {
    tag: el.tagName.toLowerCase(),
    text: visibleTextOf(el),
    attrs,
    box,
  };
}

/** 元素的可见文本（innerText 优先，回退 textContent 清理）。 */
export function visibleTextOf(el: Element): string {
  if (
    typeof (el as HTMLElement).innerText === 'string' &&
    (el as HTMLElement).innerText.length > 0
  ) {
    return (el as HTMLElement).innerText.trim();
  }
  const tc = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return tc.length > 200 ? `${tc.slice(0, 200)}…` : tc;
}

/** 按 CSS 选择器定位（首选可见元素；不可见时退回第一个匹配）。 */
export function findByCss(doc: Document, selector: string): Located {
  const els = Array.from(doc.querySelectorAll(selector));
  if (els.length === 0) {
    throw Object.assign(new Error(`no element matches selector '${selector}'`), {
      code: 'TARGET_NOT_FOUND',
    });
  }
  const element = els.find(isVisible) ?? els[0]!;
  return { element, info: toElementInfo(element) };
}

export interface FindByTextOptions {
  within?: string;
  role?: string;
  exact?: boolean;
  nth?: number;
  /** click-text 只考虑可点击目标；纯文本容器不参与 */
  actionableOnly?: boolean;
}

const ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'option',
  'checkbox',
  'radio',
  'switch',
]);

/** 显式 role 或隐式角色（只覆盖 click-text 需要的集合）。 */
export function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit !== null && explicit.trim() !== '') return explicit.trim().toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'summary') return 'button';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') {
      return 'button';
    }
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'text' || type === 'search' || type === 'email' || type === 'url') {
      return 'textbox';
    }
  }
  return undefined;
}

export function isActionable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' && el.hasAttribute('href')) return true;
  if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return true;
  }
  const role = roleOf(el);
  return role !== undefined && ACTIONABLE_ROLES.has(role);
}

function candidatesIn(doc: Document, within: string | undefined): Element[] {
  const roots = within !== undefined ? Array.from(doc.querySelectorAll(within)) : [doc.body];
  const out = new Set<Element>();
  for (const root of roots) {
    out.add(root);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node !== null) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'script' && tag !== 'style') out.add(el);
      node = walker.nextNode();
    }
  }
  return Array.from(out);
}

/**
 * 按可见文本定位：模糊包含/精确匹配，可见性过滤。
 * `actionableOnly` 先剔除纯文本容器；仅剩 1 个可点击目标时直接返回。
 * `nth` 按 DOM 顺序在候选（可见/角色过滤后）中选择。
 */
export function findByText(doc: Document, text: string, options: FindByTextOptions = {}): Located {
  const needle = text.trim().toLowerCase();
  let candidates = candidatesIn(doc, options.within).filter((el) => {
    const value = visibleTextOf(el).toLowerCase();
    return options.exact === true ? value === needle : value.includes(needle);
  });

  if (options.role !== undefined) {
    const role = options.role.toLowerCase();
    candidates = candidates.filter((el) => roleOf(el) === role);
  }
  if (options.actionableOnly === true) {
    candidates = candidates.filter(isActionable);
    if (candidates.length === 0) {
      throw Object.assign(new Error(`no actionable element contains text '${text}'`), {
        code: 'TARGET_NOT_FOUND',
      });
    }
  }

  const visible = candidates.filter(isVisible);
  if (visible.length === 0) {
    throw Object.assign(new Error(`no visible element contains text '${text}'`), {
      code: 'TARGET_NOT_FOUND',
    });
  }

  if (options.nth !== undefined) {
    const element = visible[options.nth];
    if (element === undefined) {
      throw Object.assign(
        new Error(`text '${text}' has only ${visible.length} match(es); nth=${options.nth}`),
        { code: 'TARGET_NOT_FOUND' },
      );
    }
    return { element, info: toElementInfo(element) };
  }

  // 优先最深层匹配：过滤掉包含其他匹配候选的祖先元素（容器 vs 内容）
  const deepest = visible.filter(
    (el) => !visible.some((other) => other !== el && el.contains(other)),
  );

  // 取文本最短者（最具体），若唯一则用之；否则歧义
  deepest.sort((a, b) => visibleTextOf(a).length - visibleTextOf(b).length);
  const shortest = visibleTextOf(deepest[0]!);
  const best = deepest.filter((el) => visibleTextOf(el) === shortest);
  if (best.length > 1) {
    throw Object.assign(
      new Error(
        `multiple elements match text '${text}' (${best.length}); use a CSS selector, --role, --within or --nth`,
      ),
      {
        code: 'TARGET_AMBIGUOUS',
      },
    );
  }
  const element = best[0]!;
  return { element, info: toElementInfo(element) };
}

/** 通用定位入口：css / text。 */
export function locate(
  doc: Document,
  method: 'click' | 'click-text',
  params: Record<string, unknown>,
): Located {
  if (method === 'click-text') {
    return findByText(doc, String(params.text ?? ''), {
      within: typeof params.within === 'string' ? params.within : undefined,
      role: typeof params.role === 'string' ? params.role : undefined,
      exact: params.exact === true,
      nth: params.nth !== undefined ? Number(params.nth) : undefined,
      actionableOnly: true,
    });
  }
  return findByCss(doc, String(params.selector ?? ''));
}
