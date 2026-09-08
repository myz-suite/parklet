import { findByCss, locate, toElementInfo, type Located } from './locator.js';
import { buildPageSnapshot, getScrollY, getViewport } from './snapshot.js';
import type { ElementInfo, SearchResult } from '@parkinglot/protocol';

/** DOM 层命令执行器：在页面上下文执行单个命令并返回命令特有结果。 */

function withElement(
  doc: Document,
  params: Record<string, unknown>,
  key: string,
  fn: (l: Located) => unknown,
): unknown {
  const located = findByCss(doc, String(params[key]));
  return fn(located);
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

export async function executeDomAction(
  method: string,
  params: Record<string, unknown>,
  doc: Document,
  tabId: number,
  navId: number,
): Promise<unknown> {
  switch (method) {
    case 'goto': {
      const url = String(params.url ?? '');
      doc.location.assign(url);
      return {};
    }
    case 'back':
      history.back();
      return {};
    case 'forward':
      history.forward();
      return {};
    case 'reload':
      doc.location.reload();
      return {};

    case 'click': {
      const l = locate(doc, 'click', params);
      (l.element as HTMLElement).click();
      return { element: l.info };
    }
    case 'click-text': {
      const l = locate(doc, 'click-text', params);
      (l.element as HTMLElement).click();
      return { element: l.info };
    }
    case 'fill': {
      return withElement(doc, params, 'selector', (l) => {
        const el = l.element as HTMLInputElement | HTMLTextAreaElement;
        el.value = String(params.value ?? '');
        fire(el, 'input');
        fire(el, 'change');
        return { element: l.info };
      });
    }
    case 'type': {
      return withElement(doc, params, 'selector', (l) => {
        const el = l.element as HTMLInputElement | HTMLTextAreaElement;
        el.focus();
        const text = String(params.text ?? '');
        for (const ch of text) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
          el.value += ch;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch }));
        }
        fire(el, 'change');
        return { element: l.info };
      });
    }
    case 'press': {
      const key = String(params.key ?? '');
      const target =
        params.selector !== undefined
          ? findByCss(doc, String(params.selector)).element
          : (doc.activeElement ?? doc.body);
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      return { element: toElementInfo(target) };
    }
    case 'hover': {
      return withElement(doc, params, 'selector', (l) => {
        l.element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        l.element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        return { element: l.info };
      });
    }
    case 'select': {
      return withElement(doc, params, 'selector', (l) => {
        const select = l.element as HTMLSelectElement;
        const value = params.value !== undefined ? String(params.value) : undefined;
        const label = params.label !== undefined ? String(params.label) : undefined;
        const option = Array.from(select.options).find(
          (o) => o.value === value || (label !== undefined && o.text.includes(label)),
        );
        if (!option) {
          throw Object.assign(
            new Error(`no option matches value='${value ?? ''}' label='${label ?? ''}'`),
            {
              code: 'TARGET_NOT_FOUND',
            },
          );
        }
        select.value = option.value;
        fire(select, 'change');
        return { element: l.info };
      });
    }

    case 'scroll': {
      if (params.selector !== undefined) {
        const l = findByCss(doc, String(params.selector));
        (l.element as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (params.direction !== undefined) {
        const dir = String(params.direction);
        const amount =
          params.amount !== undefined
            ? Number(params.amount)
            : Math.round(window.innerHeight * 0.8);
        const delta =
          dir === 'up'
            ? -amount
            : dir === 'top'
              ? -window.scrollY
              : dir === 'bottom'
                ? document.body.scrollHeight
                : amount;
        window.scrollBy({ top: delta, behavior: 'smooth' });
      } else if (params.amount !== undefined) {
        window.scrollBy({ top: Number(params.amount), behavior: 'smooth' });
      }
      return { viewport: getViewport() };
    }
    case 'screenshot':
      // 由 background 处理（chrome.tabs.captureVisibleTab）
      throw Object.assign(new Error('screenshot must be handled by the background'), {
        code: 'INTERNAL',
      });

    case 'extract': {
      const limit = params.limit !== undefined ? Number(params.limit) : undefined;
      return { snapshot: buildPageSnapshot(doc, tabId, navId, limit) };
    }
    case 'get-page-info': {
      return {
        url: doc.location.href,
        title: doc.title,
        viewport: getViewport(),
        scrollY: getScrollY(),
      };
    }

    case 'fetch': {
      return pageFetch(params);
    }
    case 'search':
      // 由 background 处理（导航 + 解析）
      throw Object.assign(new Error('search must be handled by the background'), {
        code: 'INTERNAL',
      });

    case 'wait': {
      await waitFor(params, doc);
      return {};
    }

    case 'eval': {
      // 页面上下文执行（server 默认禁用，需显式开启）
      const fn = new Function(`"use strict"; return (${String(params.expression ?? '')});`);
      return { value: await fn() };
    }

    default:
      throw Object.assign(new Error(`unknown method '${method}'`), { code: 'UNKNOWN_METHOD' });
  }
}

/** 页面上下文 fetch：带登录态（credentials: include），返回状态/头/体。 */
async function pageFetch(params: Record<string, unknown>): Promise<{
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  body: string;
}> {
  const headers = (params.headers ?? {}) as Record<string, string>;
  const res = await fetch(String(params.url), {
    method: String(params.method ?? 'GET'),
    headers,
    body: params.body !== undefined ? String(params.body) : undefined,
    credentials: 'include',
    redirect: 'follow',
  });
  const headerEntries: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headerEntries[key] = value;
  });
  let body = '';
  const returnType = String(params.returnType ?? 'text');
  if (returnType === 'binary') {
    const buf = new Uint8Array(await res.arrayBuffer());
    body = btoa(String.fromCharCode(...buf));
  } else if (returnType === 'json') {
    body = await res.text();
  } else {
    body = await res.text();
  }
  return { status: res.status, statusText: res.statusText, headers: headerEntries, body };
}

/** 等待：ms / 元素可见（轮询）/ 网络空闲近似（load）。 */
async function waitFor(params: Record<string, unknown>, doc: Document): Promise<void> {
  if (params.ms !== undefined) {
    await sleep(Number(params.ms));
    return;
  }
  if (params.selector !== undefined) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const el = doc.querySelector(String(params.selector));
      if (el !== null && el.getBoundingClientRect().width > 0) return;
      await sleep(100);
    }
    throw Object.assign(new Error(`element '${params.selector}' did not appear within 10s`), {
      code: 'TARGET_NOT_FOUND',
    });
  }
  if (params.condition === 'load' || params.condition === 'networkidle') {
    if (doc.readyState === 'complete') return;
    await new Promise<void>((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
    return;
  }
  throw Object.assign(new Error('wait requires ms / selector / condition'), {
    code: 'INVALID_PARAMS',
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 解析搜索引擎结果页（DuckDuckGo html 版 / Google）。 */
export function parseSearchResults(doc: Document): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo html 版：.result > .result__a / .result__snippet
  for (const el of doc.querySelectorAll('.result')) {
    const link = el.querySelector('a.result__a');
    const snippet = el.querySelector('.result__snippet');
    if (link !== null && link.textContent !== null) {
      results.push({
        title: link.textContent.trim(),
        url: (link as HTMLAnchorElement).href,
        snippet: snippet?.textContent?.trim() ?? undefined,
      });
    }
  }

  if (results.length === 0) {
    // Google：h3 标题 + 父级 a + 相邻摘要（尽力解析）
    for (const h3 of doc.querySelectorAll('h3')) {
      const link = h3.closest('a') ?? h3.parentElement?.closest('a');
      const title = h3.textContent?.trim() ?? '';
      if (link instanceof HTMLAnchorElement && title.length > 0) {
        results.push({ title, url: link.href });
      }
    }
  }

  return results.slice(0, 10);
}

export type { ElementInfo, Located };
