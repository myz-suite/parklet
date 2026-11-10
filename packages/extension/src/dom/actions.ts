import { findByCss, findByText, locate, roleOf, toElementInfo, type Located } from './locator.js';
import { extractPage, getScrollY, getViewport, type ExtractOptions } from './snapshot.js';
import type {
  DomQueryMatch,
  ElementInfo,
  ScrollMetrics,
  ScrollResult,
  ScrollToResult,
  SearchResult,
} from '@parklet/protocol';

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

/** selection 目标：selector（CSS）或 text（可见文本）至少其一。 */
function resolveSelectionTarget(doc: Document, params: Record<string, unknown>): Element {
  if (params.selector !== undefined) return findByCss(doc, String(params.selector)).element;
  if (params.text !== undefined) return findByText(doc, String(params.text)).element;
  return fail('INVALID_PARAMS', 'selection requires selector or text');
}

/** 选中元素文本并返回选中内容：input/textarea 用 setSelectionRange，其余用 Range + Selection。 */
function selectElementText(doc: Document, el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const field = el as HTMLInputElement | HTMLTextAreaElement;
    field.focus();
    field.select();
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? field.value.length;
    return field.value.slice(start, end);
  }
  const selection = doc.getSelection();
  const range = doc.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return selection?.toString() ?? '';
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

interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  charCode: number;
}

const NAMED_KEYS: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9, charCode: 0 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27, charCode: 0 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27, charCode: 0 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8, charCode: 0 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46, charCode: 0 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, charCode: 0 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, charCode: 0 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, charCode: 0 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, charCode: 0 },
  home: { key: 'Home', code: 'Home', keyCode: 36, charCode: 0 },
  end: { key: 'End', code: 'End', keyCode: 35, charCode: 0 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33, charCode: 0 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34, charCode: 0 },
  space: { key: ' ', code: 'Space', keyCode: 32, charCode: 32 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17, charCode: 0 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, charCode: 0 },
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18, charCode: 0 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91, charCode: 0 },
};

/** 解析任意 Playwright 键名到 key/code/keyCode/charCode；未知多字符键抛 INVALID_PARAMS。 */
export function keyDef(key: string): KeyDef {
  if (key === ' ' || key.toLowerCase() === 'space') return NAMED_KEYS.space!;
  const named = NAMED_KEYS[key.toLowerCase()];
  if (named !== undefined) return named;
  if (/^f\d{1,2}$/i.test(key)) {
    const n = Number(key.slice(1));
    return { key: `F${n}`, code: `F${n}`, keyCode: 111 + n, charCode: 0 };
  }
  if ([...key].length === 1) {
    const ch = key;
    const upper = ch.toUpperCase();
    const code = /[a-z]/i.test(ch)
      ? `Key${upper}`
      : /[0-9]/.test(ch)
        ? `Digit${ch}`
        : `Key${upper}`;
    return { key: ch, code, keyCode: upper.charCodeAt(0), charCode: ch.charCodeAt(0) };
  }
  fail(
    'INVALID_PARAMS',
    `unknown key '${key}' (use a single character or a named key like Enter/ArrowDown)`,
  );
}

function dispatchKeyboard(
  target: Element,
  type: string,
  def: KeyDef,
  combo: KeyCombo,
  keyOverride?: string,
): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    key: keyOverride ?? def.key,
    code: def.code,
    ctrlKey: combo.ctrlKey,
    shiftKey: combo.shiftKey,
    altKey: combo.altKey,
    metaKey: combo.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  // KeyboardEventInit 不接受 keyCode/which/charCode；挂到实例上以兼容依赖旧属性的页面。
  const legacy: Record<string, number> = {
    keyCode: def.keyCode,
    which: def.keyCode,
    charCode: def.charCode,
  };
  for (const [name, value] of Object.entries(legacy)) {
    Object.defineProperty(event, name, { get: () => value });
  }
  target.dispatchEvent(event);
  return event;
}

function editableOf(target: Element): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return target as HTMLInputElement;
  if ((target as HTMLElement).isContentEditable) return target as HTMLElement;
  return null;
}

function fireInput(target: Element): void {
  target.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/** 模拟按键的默认动作（合成事件不会触发原生默认行为）。 */
function applyDefaultAction(
  target: Element,
  def: KeyDef,
  combo: KeyCombo,
  down: KeyboardEvent,
): void {
  if (down.defaultPrevented) return;
  const editable = editableOf(target);
  const shortcutModifier = combo.ctrlKey || combo.metaKey;

  if (shortcutModifier && def.key.toLowerCase() === 'a') {
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement)
      editable.select();
    else if (editable !== null) {
      const range = document.createRange();
      range.selectNodeContents(editable);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return;
  }

  if ((def.key === 'Backspace' || def.key === 'Delete') && editable !== null) {
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      const start = editable.selectionStart ?? editable.value.length;
      const end = editable.selectionEnd ?? start;
      if (start !== end)
        editable.value = editable.value.slice(0, start) + editable.value.slice(end);
      else if (def.key === 'Backspace' && start > 0)
        editable.value = editable.value.slice(0, start - 1) + editable.value.slice(start);
      else if (def.key === 'Delete' && start < editable.value.length)
        editable.value = editable.value.slice(0, start) + editable.value.slice(start + 1);
      fireInput(editable);
    }
    return;
  }

  // 仅可打印键（单字符，如字母/数字/空格）插入文本；Enter 等具名键 charCode>0 但不应插入
  if (
    def.key.length === 1 &&
    def.charCode > 0 &&
    !shortcutModifier &&
    !combo.altKey &&
    editable !== null
  ) {
    // execCommand 会同步触发 input；失败则手动插入并补事件
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, def.key);
    } catch {
      inserted = false;
    }
    if (
      !inserted &&
      (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement)
    ) {
      const start = editable.selectionStart ?? editable.value.length;
      const end = editable.selectionEnd ?? start;
      editable.value = editable.value.slice(0, start) + def.key + editable.value.slice(end);
      editable.setSelectionRange(start + def.key.length, start + def.key.length);
      fireInput(editable);
    }
    return;
  }

  if (def.key === 'Enter') {
    const form = target.closest('form');
    if (form !== null) {
      try {
        form.requestSubmit();
      } catch {
        form.submit();
      }
    }
    return;
  }

  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    const move: Record<string, () => number> = {
      ArrowLeft: () => Math.max(0, (editable.selectionStart ?? 0) - 1),
      ArrowRight: () => Math.min(editable.value.length, (editable.selectionEnd ?? 0) + 1),
      Home: () => 0,
      End: () => editable.value.length,
    };
    const next = move[def.key];
    if (next !== undefined) editable.setSelectionRange(next(), next());
  }
}

/** Resolve on the next animation frame, bounded by a timer for hidden documents. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    // hidden documents pause rAF; always bound the wait with a timer.
    setTimeout(finish, 50);
    const raf = (
      globalThis as typeof globalThis & {
        requestAnimationFrame?: (cb: FrameRequestCallback) => number;
      }
    ).requestAnimationFrame;
    if (typeof raf === 'function') raf(() => finish());
  });
}

/** 等待滚动位置连续 2 帧不变；最多 maxMs，返回是否稳定。 */
async function settleScroll(read: () => number, maxMs = 1000): Promise<boolean> {
  const start = Date.now();
  let last = read();
  let stable = 0;
  while (Date.now() - start < maxMs) {
    await nextFrame();
    const current = read();
    if (Math.abs(current - last) < 1) {
      stable += 1;
      if (stable >= 2) return true;
    } else {
      stable = 0;
      last = current;
    }
  }
  return false;
}

/** Snapshot page and scrollable-ancestor offsets for scroll settling. */
function scrollOffsets(el: Element): string {
  const parts = [`${window.scrollX},${window.scrollY}`];
  let current = el.parentElement;
  while (current !== null) {
    const style = getComputedStyle(current);
    if (/(auto|scroll|overlay|hidden)/.test(`${style.overflowX} ${style.overflowY}`)) {
      parts.push(`${current.scrollLeft},${current.scrollTop}`);
    }
    current = current.parentElement;
  }
  return parts.join('|');
}

/** Wait until a composite position signature is unchanged for 2 frames. */
async function settleSignature(read: () => string, maxMs = 1000): Promise<boolean> {
  const start = Date.now();
  let last = read();
  let stable = 0;
  while (Date.now() - start < maxMs) {
    await nextFrame();
    const current = read();
    if (current === last) {
      stable += 1;
      if (stable >= 2) return true;
    } else {
      stable = 0;
      last = current;
    }
  }
  return false;
}

/** Normalize document.visibilityState for the wire contract. */
function visibilityOf(doc: Document): 'visible' | 'hidden' {
  return doc.visibilityState === 'hidden' ? 'hidden' : 'visible';
}

/** Return a warning when the target document is hidden. */
function backgroundWarning(doc: Document): 'BACKGROUND_TAB' | undefined {
  return visibilityOf(doc) === 'hidden' ? 'BACKGROUND_TAB' : undefined;
}

/** Read page scroll metrics (with viewport fallbacks). */
function pageMetrics(doc: Document): ScrollMetrics {
  const el = doc.scrollingElement ?? doc.documentElement;
  return {
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    scrollHeight: el.scrollHeight,
    scrollWidth: el.scrollWidth,
    clientHeight: el.clientHeight || window.innerHeight,
    clientWidth: el.clientWidth || window.innerWidth,
  };
}

/** Read an element's own scroll metrics. */
function elementMetrics(el: HTMLElement): ScrollMetrics {
  return {
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    scrollHeight: el.scrollHeight,
    scrollWidth: el.scrollWidth,
    clientHeight: el.clientHeight,
    clientWidth: el.clientWidth,
  };
}

/** Throw the structured NO_EFFECT error for a zero-delta scroll. */
function noEffectError(result: ScrollResult): never {
  throw Object.assign(
    new Error(`scroll had no effect (atTop=${result.atTop}, atBottom=${result.atBottom})`),
    {
      code: 'NO_EFFECT',
      data: {
        before: result.before,
        after: result.after,
        atTop: result.atTop,
        atBottom: result.atBottom,
      },
    },
  );
}

/** Enforce NO_EFFECT unless the caller explicitly allows a no-op. */
function assertEffect(result: ScrollResult, allowNoop: boolean): ScrollResult {
  if (allowNoop) return result;
  if (result.delta.x === 0 && result.delta.y === 0) noEffectError(result);
  return result;
}

/** Scroll the page and return verifiable before/after state. */
async function scrollPage(doc: Document, params: Record<string, unknown>): Promise<ScrollResult> {
  const before = { x: window.scrollX, y: window.scrollY };
  const metricsBefore = pageMetrics(doc);
  let delta = 0;
  if (params.to === 'top') delta = -before.y;
  else if (params.to === 'bottom') {
    delta = metricsBefore.scrollHeight - metricsBefore.clientHeight - before.y;
  } else {
    delta = Number(params.by ?? 0);
  }
  if (params.to === 'bottom' && delta < 0) delta = 0;

  window.scrollBy({
    top: delta,
    behavior: params.smooth === true ? 'smooth' : 'auto',
  });
  const settled = params.settle === false ? false : await settleScroll(() => window.scrollY, 1000);
  const after = { x: window.scrollX, y: window.scrollY };
  const metrics = pageMetrics(doc);
  const result: ScrollResult = {
    target: 'page',
    before,
    after,
    delta: { x: after.x - before.x, y: after.y - before.y },
    atTop: after.y <= 0,
    atBottom: after.y + window.innerHeight >= metrics.scrollHeight - 1,
    settled,
    visibilityState: visibilityOf(doc),
    viewport: getViewport(),
  };
  const warning = backgroundWarning(doc);
  if (warning !== undefined) result.warning = warning;
  return assertEffect(result, params.allowNoop === true);
}

/** Scroll an element's own overflow content and return verifiable state. */
async function scrollElement(
  doc: Document,
  el: Element,
  params: Record<string, unknown>,
): Promise<ScrollResult> {
  const target = el as HTMLElement;
  const before = { x: target.scrollLeft, y: target.scrollTop };
  const metricsBefore = elementMetrics(target);
  let delta = 0;
  if (params.to === 'top') delta = -before.y;
  else if (params.to === 'bottom') {
    delta = metricsBefore.scrollHeight - metricsBefore.clientHeight - before.y;
  } else {
    delta = Number(params.by ?? 0);
  }
  if (params.to === 'bottom' && delta < 0) delta = 0;

  target.scrollBy({
    top: delta,
    left: 0,
    behavior: params.smooth === true ? 'smooth' : 'auto',
  });
  const settled =
    params.settle === false ? false : await settleScroll(() => target.scrollTop, 1000);
  const after = { x: target.scrollLeft, y: target.scrollTop };
  const metrics = elementMetrics(target);
  const result: ScrollResult = {
    target: { selector: String(params.selector) },
    before,
    after,
    delta: { x: after.x - before.x, y: after.y - before.y },
    atTop: after.y <= 0,
    atBottom: after.y + metrics.clientHeight >= metrics.scrollHeight - 1,
    settled,
    visibilityState: visibilityOf(doc),
    viewport: getViewport(),
    metrics,
  };
  const warning = backgroundWarning(doc);
  if (warning !== undefined) result.warning = warning;
  return assertEffect(result, params.allowNoop === true);
}

/** Bring an element into view, settle page/ancestors, and report its new box. */
async function scrollToElement(
  doc: Document,
  params: Record<string, unknown>,
): Promise<ScrollToResult> {
  const located = findByCss(doc, String(params.selector));
  const before = { x: window.scrollX, y: window.scrollY };
  (located.element as HTMLElement).scrollIntoView({
    behavior: params.smooth === true ? 'smooth' : 'auto',
    block: 'center',
  });
  const settled =
    params.settle === false
      ? false
      : await settleSignature(() => scrollOffsets(located.element), 1000);
  if (!located.element.isConnected) {
    throw Object.assign(new Error('target was replaced while scrolling'), {
      code: 'TARGET_NOT_FOUND',
    });
  }
  const after = { x: window.scrollX, y: window.scrollY };
  const metrics = pageMetrics(doc);
  const result: ScrollToResult = {
    element: toElementInfo(located.element),
    target: 'page',
    before,
    after,
    delta: { x: after.x - before.x, y: after.y - before.y },
    atTop: after.y <= 0,
    atBottom: after.y + window.innerHeight >= metrics.scrollHeight - 1,
    settled,
    visibilityState: visibilityOf(doc),
    viewport: getViewport(),
  };
  const warning = backgroundWarning(doc);
  if (warning !== undefined) result.warning = warning;
  return result;
}

/** dom-query：按 CSS 或可见文本返回匹配元素概要（探索用，不含子树）。 */
function domQuery(
  doc: Document,
  params: Record<string, unknown>,
): { matches: DomQueryMatch[]; total: number } {
  if (params.text !== undefined) {
    const located = findByText(doc, String(params.text));
    return { matches: [toDomQueryMatch(located.element)], total: 1 };
  }
  const els = Array.from(doc.querySelectorAll(String(params.selector ?? '')));
  const limit = params.limit !== undefined ? Number(params.limit) : 20;
  return { matches: els.slice(0, limit).map(toDomQueryMatch), total: els.length };
}

function toDomQueryMatch(el: Element): DomQueryMatch {
  const info = toElementInfo(el);
  const match: DomQueryMatch = { tag: info.tag };
  const cls = info.attrs.class;
  const id = info.attrs.id;
  if (cls !== undefined) match.class = cls;
  if (id !== undefined) match.id = id;
  if (info.text !== undefined) match.text = info.text;
  if (info.box !== undefined) match.box = info.box;
  return match;
}

export async function executeDomAction(
  method: string,
  params: Record<string, unknown>,
  doc: Document,
  tabId: number,
  navId: number,
): Promise<unknown> {
  switch (method) {
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
      const def = keyDef(combo.key);
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
      for (const m of pressed) dispatchKeyboard(target, 'keydown', keyDef(m.key), combo);
      const down = dispatchKeyboard(target, 'keydown', def, combo);
      // keypress 仅在“会产生文本”时触发（非 Ctrl/Meta 快捷键）
      if (def.charCode > 0 && !combo.ctrlKey && !combo.metaKey) {
        dispatchKeyboard(target, 'keypress', def, combo);
      }
      applyDefaultAction(target, def, combo, down);
      dispatchKeyboard(target, 'keyup', def, combo);
      for (const m of [...pressed].reverse())
        dispatchKeyboard(target, 'keyup', keyDef(m.key), combo);
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
        // 滚动元素**自身**的 overflow 内容（可反复触发懒加载）；不改变页面滚动
        const el = findByCss(doc, String(params.selector)).element;
        return scrollElement(doc, el, params);
      }
      return scrollPage(doc, params);
    }
    case 'scroll-to': {
      return scrollToElement(doc, params);
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
      const metrics = pageMetrics(doc);
      const active = doc.activeElement;
      const result: Record<string, unknown> = {
        url: doc.location.href,
        title: doc.title,
        viewport: getViewport(),
        scrollY: getScrollY(),
        readyState: doc.readyState,
        visibilityState: visibilityOf(doc),
        selection: doc.getSelection()?.toString() ?? '',
        scroll: {
          x: window.scrollX,
          y: window.scrollY,
          scrollWidth: metrics.scrollWidth,
          scrollHeight: metrics.scrollHeight,
          clientWidth: metrics.clientWidth,
          clientHeight: metrics.clientHeight,
        },
      };
      if (active !== null) {
        const tag = active.tagName.toLowerCase();
        result.activeElement = {
          tag,
          ...(active.id !== '' ? { id: active.id } : {}),
          ...(roleOf(active) !== undefined ? { role: roleOf(active) } : {}),
        };
      }
      if (params.selector !== undefined) {
        const matches = Array.from(doc.querySelectorAll(String(params.selector)));
        result.selector = {
          count: matches.length,
          ...(matches[0] !== undefined && toElementInfo(matches[0]).box !== undefined
            ? { box: toElementInfo(matches[0]).box }
            : {}),
        };
      }
      return result;
    }

    case 'dom-query': {
      return domQuery(doc, params);
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
      return waitFor(params, doc);
    }

    case 'selection': {
      const el = resolveSelectionTarget(doc, params);
      return { text: selectElementText(doc, el) };
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

/** 等待：ms / 元素数量稳定 / SPA 内容稳定 / load。 */
async function waitFor(
  params: Record<string, unknown>,
  doc: Document,
): Promise<{ matched?: number; waitedMs: number; stable: boolean }> {
  const started = Date.now();
  if (params.ms !== undefined) {
    await sleep(Number(params.ms));
    return { waitedMs: Date.now() - started, stable: true };
  }
  if (params.selector !== undefined) {
    const selector = String(params.selector);
    const count = params.count !== undefined ? Math.max(1, Number(params.count)) : 1;
    const stableMs =
      params.stableMs !== undefined ? Math.max(0, Number(params.stableMs)) : undefined;
    const deadline = Date.now() + 10_000;
    let lastCount = -1;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const matches = Array.from(doc.querySelectorAll(selector));
      const enough = matches.length >= count;
      const visibleEnough = count > 1 || matches.some((el) => el.getBoundingClientRect().width > 0);
      if (enough && visibleEnough) {
        if (stableMs === undefined) {
          return { matched: matches.length, waitedMs: Date.now() - started, stable: true };
        }
        if (matches.length !== lastCount) {
          lastCount = matches.length;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableMs) {
          return { matched: matches.length, waitedMs: Date.now() - started, stable: true };
        }
      } else {
        lastCount = -1;
        stableSince = 0;
      }
      await sleep(100);
    }
    throw Object.assign(
      new Error(`element '${selector}' did not reach count=${count} within 10s`),
      { code: 'TIMEOUT' },
    );
  }
  if (params.condition === 'content') {
    const stableMs = params.stableMs !== undefined ? Math.max(0, Number(params.stableMs)) : 500;
    const deadline = Date.now() + 10_000;
    let last = '';
    let stableSince = 0;
    while (Date.now() < deadline) {
      const text = (doc.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 20_000);
      const signature = `${doc.location.href}\n${text}`;
      if (signature !== last) {
        last = signature;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stableMs) {
        return { waitedMs: Date.now() - started, stable: true };
      }
      await sleep(100);
    }
    throw Object.assign(new Error('page content did not stabilize within 10s'), {
      code: 'TIMEOUT',
    });
  }
  if (params.condition === 'load' || params.condition === 'networkidle') {
    if (doc.readyState === 'complete') {
      return { waitedMs: Date.now() - started, stable: true };
    }
    await new Promise<void>((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
    return { waitedMs: Date.now() - started, stable: true };
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
    // Google：h3 标题 + 父级 a + 尽力解析摘要（多选择器 + 回退，DOM 变动时可能缺失）
    for (const h3 of doc.querySelectorAll('h3')) {
      const link = h3.closest('a') ?? h3.parentElement?.closest('a');
      const title = h3.textContent?.trim() ?? '';
      if (link instanceof HTMLAnchorElement && title.length > 0) {
        results.push({ title, url: link.href, snippet: googleSnippet(h3) });
      }
    }
  }

  return results.slice(0, 10);
}

/** Google 结果摘要：主选择器 + 回退链，取不到返回 undefined（best-effort）。 */
function googleSnippet(h3: Element): string | undefined {
  const container = h3.parentElement?.parentElement ?? h3.parentElement;
  if (container === null || container === undefined) return undefined;
  const selectors = [
    '.VwiC3b',
    '.aCOpRe',
    '.IsZvec',
    '.lEBKkf',
    'span.st',
    '.MUxGbd',
    '[data-sncf]',
  ];
  for (const selector of selectors) {
    const text = container.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    if (text !== undefined && text.length > 0) return text;
  }
  // 回退：容器内最长的、不同于标题的文本块
  const title = h3.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const candidates = Array.from(container.querySelectorAll('div, span'))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 20 && t !== title && !t.includes(title));
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

export type { ElementInfo, Located };
