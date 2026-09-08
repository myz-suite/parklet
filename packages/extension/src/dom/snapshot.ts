import type { ContextSnapshot, PageSnapshot, Viewport } from '@parkinglot/protocol';

/** 页面快照提取（纯 DOM 逻辑，happy-dom 可测）。 */

function skipElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'svg'
  );
}

/** 提取页面可见文本（body.innerText 近似，排除 script/style）。 */
export function extractVisibleText(doc: Document, limit?: number): string {
  let text = '';
  const body = doc.body;
  if (typeof body.innerText === 'string' && body.innerText.length > 0) {
    text = body.innerText.trim();
  } else {
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let node = walker.nextNode();
    while (node !== null) {
      const parent = node.parentElement;
      if (parent !== null && !skipElement(parent)) {
        parts.push(node.textContent ?? '');
      }
      node = walker.nextNode();
    }
    text = parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  if (limit !== undefined && limit > 0 && text.length > limit) {
    return `${text.slice(0, limit)}…`;
  }
  return text;
}

export function getViewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function getScrollY(): number {
  return window.scrollY;
}

export function buildContextSnapshot(doc: Document, tabId: number, navId: number): ContextSnapshot {
  return {
    url: doc.location.href,
    title: doc.title,
    navId,
    tabId,
  };
}

export function buildPageSnapshot(
  doc: Document,
  tabId: number,
  navId: number,
  limit?: number,
): PageSnapshot {
  return {
    context: buildContextSnapshot(doc, tabId, navId),
    visibleText: extractVisibleText(doc, limit),
    viewport: getViewport(),
    scrollY: getScrollY(),
  };
}
