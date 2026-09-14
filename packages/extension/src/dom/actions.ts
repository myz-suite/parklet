import { findByCss, locate, toElementInfo, type Located } from './locator.js';
import { extractPage, getScrollY, getViewport, type ExtractOptions } from './snapshot.js';
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

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

const INPUT_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function isEditable(el: Element | null): el is HTMLElement {
  if (el === null) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  const ce = el.getAttribute('contenteditable');
  return ce !== null && ce !== 'false';
}

/**
 * 智能解析输入目标：selector 可指向真正的 input/textarea，也可指向 label/容器/相邻元素。
 * 优先级：自身可编辑 > label[for] > 最近 label/fieldset 内唯一可编辑 > 后代唯一可编辑；
 * 多候选且无 label[for] 精确匹配 → TARGET_AMBIGUOUS；找不到 → TARGET_NOT_FOUND。
 */
export function resolveInput(doc: Document, selector: string): HTMLElement {
  const el = doc.querySelector(selector);
  if (el === null) fail('TARGET_NOT_FOUND', `no element matches '${selector}'`);
  if (isEditable(el)) return el;

  const byFor = (scope: Element): HTMLElement | undefined => {
    const forId = scope.getAttribute('for');
    if (forId === null) return undefined;
    const target = doc.getElementById(forId);
    return isEditable(target) ? target : undefined;
  };

  // el 自身是 label：label[for] 或 label 内唯一可编辑元素
  if (el.tagName.toLowerCase() === 'label') {
    const viaFor = byFor(el);
    if (viaFor !== undefined) return viaFor;
    const inner = Array.from(el.querySelectorAll(INPUT_SELECTOR)).filter(isEditable);
    if (inner.length === 1) return inner[0]!;
    if (inner.length > 1) fail('TARGET_AMBIGUOUS', `label '${selector}' contains multiple inputs`);
  }

  // 最近的 label / fieldset 作用域
  const scope = el.closest('label, fieldset');
  if (scope !== null) {
    const viaFor = byFor(scope);
    if (viaFor !== undefined) return viaFor;
    const inner = Array.from(scope.querySelectorAll(INPUT_SELECTOR)).filter(isEditable);
    if (inner.length === 1) return inner[0]!;
    if (inner.length > 1) {
      fail(
        'TARGET_AMBIGUOUS',
        `'${selector}' resolves to multiple inputs; use a more specific selector`,
      );
    }
  }

  // 后代中的唯一可编辑元素
  const descendants = Array.from(el.querySelectorAll(INPUT_SELECTOR)).filter(isEditable);
  if (descendants.length === 1) return descendants[0]!;
  if (descendants.length > 1) {
    fail(
      'TARGET_AMBIGUOUS',
      `'${selector}' contains multiple inputs; use a more specific selector`,
    );
  }

  return fail('TARGET_NOT_FOUND', `no input found for '${selector}'`);
}

export interface KeyCombo {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** 解析 Playwright 风格组合键，如 "Control+c" / "Meta+s" / "Shift+Tab"。 */
export function parseKeyCombo(combo: string): KeyCombo {
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  let ctrlKey = false;
  let shiftKey = false;
  let altKey = false;
  let metaKey = false;
  let key = '';
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'control':
      case 'ctrl':
        ctrlKey = true;
        break;
      case 'shift':
        shiftKey = true;
        break;
      case 'alt':
      case 'option':
        altKey = true;
        break;
      case 'meta':
      case 'command':
      case 'cmd':
      case 'super':
        metaKey = true;
        break;
      default:
        key = part;
    }
  }
  if (key === '') key = parts[parts.length - 1] ?? '';
  return { key, ctrlKey, shiftKey, altKey, metaKey };
}

function dispatchKey(target: Element, type: string, key: string, combo: KeyCombo): void {
  target.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      ctrlKey: combo.ctrlKey,
      shiftKey: combo.shiftKey,
      altKey: combo.altKey,
      metaKey: combo.metaKey,
      bubbles: true,
    }),
  );
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
      const el = resolveInput(doc, String(params.selector));
      const value = String(params.value ?? '');
      if (el.isContentEditable) {
        el.textContent = value;
      } else {
        (el as HTMLInputElement | HTMLTextAreaElement).value = value;
      }
      fire(el, 'input');
      fire(el, 'change');
      return { element: toElementInfo(el) };
    }
    case 'type': {
      const el = resolveInput(doc, String(params.selector));
      el.focus();
      const text = String(params.text ?? '');
      const isField =
        el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea';
      for (const ch of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
        if (isField) (el as HTMLInputElement).value += ch;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch }));
      }
      fire(el, 'change');
      return { element: toElementInfo(el) };
    }
    case 'press': {
      const combo = parseKeyCombo(String(params.key ?? ''));
      const target =
        params.selector !== undefined
          ? findByCss(doc, String(params.selector)).element
          : (doc.activeElement ?? doc.body);

      const modifiers: Array<{ key: string; on: boolean }> = [
        { key: 'Control', on: combo.ctrlKey },
        { key: 'Shift', on: combo.shiftKey },
        { key: 'Alt', on: combo.altKey },
        { key: 'Meta', on: combo.metaKey },
      ];
      const pressed = modifiers.filter((m) => m.on);
      for (const m of pressed) dispatchKey(target, 'keydown', m.key, combo);
      dispatchKey(target, 'keydown', combo.key, combo);
      dispatchKey(target, 'keypress', combo.key, combo);
      dispatchKey(target, 'keyup', combo.key, combo);
      for (const m of [...pressed].reverse()) dispatchKey(target, 'keyup', m.key, combo);
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
      return extractPage(doc, params as ExtractOptions, tabId, navId);
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

/** 页面上下文 fetch：同域请求自动携带登录态 cookie。
 * 默认 credentials: 'same-origin' —— 跨域 'include' 会要求服务器返回精确
 * origin + Access-Control-Allow-Credentials，公共 API（ACAO:*）会被浏览器拒绝。 */
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
    credentials: 'same-origin',
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
