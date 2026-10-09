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

/** 按可见文本定位：模糊包含匹配，可见性过滤，最具体优先，仍歧义则报 TARGET_AMBIGUOUS。 */
export function findByText(doc: Document, text: string): Located {
  const needle = text.trim().toLowerCase();
  const candidates: Element[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node !== null) {
    const el = node as Element;
    if (el.tagName.toLowerCase() !== 'script' && el.tagName.toLowerCase() !== 'style') {
      const t = visibleTextOf(el).toLowerCase();
      if (t.includes(needle)) candidates.push(el);
    }
    node = walker.nextNode();
  }

  const visible = candidates.filter(isVisible);
  if (visible.length === 0) {
    throw Object.assign(new Error(`no visible element contains text '${text}'`), {
      code: 'TARGET_NOT_FOUND',
    });
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
        `multiple elements match text '${text}' (${best.length}); use a CSS selector instead`,
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
    return findByText(doc, String(params.text ?? ''));
  }
  return findByCss(doc, String(params.selector ?? ''));
}
