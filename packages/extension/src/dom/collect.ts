import type {
  FormFieldInfo,
  FormInfo,
  FormsResult,
  LinkInfo,
  LinksResult,
} from '@parkinglot/protocol';
import { isVisible, visibleTextOf } from './locator.js';

/**
 * 页面交互元素采集（links / forms）。
 * - 纯 DOM 逻辑，可在 happy-dom 下测试；但 URL 相对解析与 visibility 需真实浏览器 E2E 佐证。
 * - 采集阶段设硬上限 MAX_ITEMS（分页在采集之后，limit 不减少采集工作量）。
 */

/** 采集阶段的硬上限（按 DOM 顺序短路）。 */
export const MAX_ITEMS = 2000;

const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function optInt(value: unknown): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function optBool(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : Boolean(value);
}

/** 作用域元素查询：无 selector 时整页；有 selector 时在匹配根内（含根本身）查询。 */
function scopedQuery(doc: Document, selector: string | undefined, query: string): Element[] {
  if (selector === undefined) return Array.from(doc.querySelectorAll(query));
  const roots = Array.from(doc.querySelectorAll(selector));
  const out: Element[] = [];
  for (const root of roots) {
    if (root.matches(query)) out.push(root);
    out.push(...Array.from(root.querySelectorAll(query)));
  }
  return out;
}

/** 分页：对已采集的第一层列表切片；offset/limit 仅在提供时回显。 */
function paginate<T>(
  items: T[],
  offset: number | undefined,
  limit: number | undefined,
): { page: T[]; offset?: number; limit?: number } {
  const start = Math.max(offset ?? 0, 0);
  const end = limit !== undefined ? start + Math.max(limit, 0) : undefined;
  const result: { page: T[]; offset?: number; limit?: number } = { page: items.slice(start, end) };
  if (offset !== undefined) result.offset = offset;
  if (limit !== undefined) result.limit = limit;
  return result;
}

/** 解析锚点的绝对 href（无效 / 非目标 scheme / 空 / 纯 # 锚点 → undefined）。 */
function resolveHref(el: Element): string | undefined {
  const raw = el.getAttribute('href');
  if (raw === null || raw.trim() === '' || raw.startsWith('#')) return undefined;
  const href = (el as HTMLAnchorElement).href;
  try {
    const protocol = new URL(href).protocol;
    return LINK_SCHEMES.has(protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

export function collectLinks(doc: Document, params: Record<string, unknown>): LinksResult {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const offset = optInt(params.offset);
  const limit = optInt(params.limit);
  const visibleOnly = optBool(params.visibleOnly, true);

  const candidates = scopedQuery(doc, selector, 'a[href]');
  const groups = new Map<string, LinkInfo>();
  let truncated = false;

  for (let i = 0; i < candidates.length; i += 1) {
    const el = candidates[i]!;
    if (visibleOnly && !isVisible(el)) continue;
    const href = resolveHref(el);
    if (href === undefined) continue;
    if (groups.size >= MAX_ITEMS && !groups.has(href)) {
      truncated = true;
      break;
    }
    const text = visibleTextOf(el).trim();
    const group = groups.get(href);
    if (group === undefined) {
      groups.set(href, { href, texts: text === '' ? [] : [text], count: 1 });
    } else {
      group.count += 1;
      if (text !== '' && !group.texts.includes(text)) group.texts.push(text);
    }
  }

  const all = Array.from(groups.values());
  const { page, offset: echoOffset, limit: echoLimit } = paginate(all, offset, limit);
  const result: LinksResult = { links: page, total: all.length };
  if (echoOffset !== undefined) result.offset = echoOffset;
  if (echoLimit !== undefined) result.limit = echoLimit;
  if (truncated) result.truncated = true;
  return result;
}

interface FormGroupMeta {
  key: string;
  action?: string;
  method?: string;
  target?: string;
}

function formGroupOf(el: Element): FormGroupMeta {
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (form === null || form === undefined) return { key: '' };
  const action = form.getAttribute('action') || undefined;
  const method = (form.getAttribute('method') || 'get').toUpperCase();
  const target = form.getAttribute('target') || undefined;
  return { key: `${action ?? ''}|${method}|${target ?? ''}`, action, method, target };
}

/** id → label[for] 文本（一次预扫描，避免逐字段 O(n)）。 */
function buildLabelIndex(doc: Document): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const label of doc.querySelectorAll('label[for]')) {
    const id = label.getAttribute('for');
    const text = visibleTextOf(label).trim();
    if (id === null || text === '') continue;
    const list = index.get(id);
    if (list === undefined) index.set(id, [text]);
    else if (!list.includes(text)) list.push(text);
  }
  return index;
}

/** labels 优先级：label[for] > 包裹 label > aria-label > placeholder（精确去重）。 */
function fieldLabels(
  el: Element,
  index: Map<string, string[]>,
  aria: string | null,
  placeholder: string | null,
): string[] {
  const labels: string[] = [];
  const push = (value: string | null | undefined): void => {
    const text = value?.trim();
    if (text !== undefined && text !== '' && !labels.includes(text)) labels.push(text);
  };
  for (const text of index.get(el.id) ?? []) push(text);
  const wrapping = el.closest('label');
  if (wrapping !== null) push(visibleTextOf(wrapping));
  push(aria);
  push(placeholder);
  return labels;
}

function fieldValue(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if (input.type === 'password') return '********';
    if (input.type === 'file') return undefined;
    return input.value;
  }
  if (tag === 'textarea') return (el as HTMLTextAreaElement).value;
  if (tag === 'select') return (el as HTMLSelectElement).value;
  if (tag === 'button') return (el as HTMLButtonElement).value || undefined;
  return undefined;
}

function toFieldInfo(el: Element, index: Map<string, string[]>): FormFieldInfo {
  const tag = el.tagName.toLowerCase();
  const type =
    tag === 'select' || tag === 'textarea'
      ? tag
      : (el as HTMLInputElement | HTMLButtonElement).type || (tag === 'button' ? 'submit' : 'text');

  const field: FormFieldInfo = {
    tag,
    type,
    labels: fieldLabels(el, index, el.getAttribute('aria-label'), el.getAttribute('placeholder')),
  };

  const name = el.getAttribute('name');
  if (name !== null && name !== '') field.name = name;
  const value = fieldValue(el);
  if (value !== undefined) field.value = value;
  const id = el.id;
  if (id !== '') field.id = id;
  if ('disabled' in el) field.disabled = Boolean((el as HTMLInputElement).disabled);
  if ('required' in el) field.required = Boolean((el as HTMLInputElement).required);
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    field.checked = (el as HTMLInputElement).checked;
  }
  if (tag === 'select') {
    field.selected = Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.value);
  }
  return field;
}

export function collectForms(doc: Document, params: Record<string, unknown>): FormsResult {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const offset = optInt(params.offset);
  const limit = optInt(params.limit);
  const visibleOnly = optBool(params.visibleOnly, true);

  const candidates = scopedQuery(doc, selector, 'input, select, textarea, button');
  const labelIndex = buildLabelIndex(doc);
  const flat: Array<{ group: FormGroupMeta; field: FormFieldInfo }> = [];
  let truncated = false;

  for (const el of candidates) {
    if (flat.length >= MAX_ITEMS) {
      truncated = true;
      break;
    }
    if (visibleOnly && !isVisible(el)) continue;
    flat.push({ group: formGroupOf(el), field: toFieldInfo(el, labelIndex) });
  }

  const total = flat.length;
  const { page, offset: echoOffset, limit: echoLimit } = paginate(flat, offset, limit);

  const groups = new Map<string, FormInfo>();
  for (const entry of page) {
    let group = groups.get(entry.group.key);
    if (group === undefined) {
      group = { fields: [] };
      if (entry.group.action !== undefined) group.action = entry.group.action;
      if (entry.group.method !== undefined) group.method = entry.group.method;
      if (entry.group.target !== undefined) group.target = entry.group.target;
      groups.set(entry.group.key, group);
    }
    group.fields.push(entry.field);
  }

  const result: FormsResult = { forms: Array.from(groups.values()), total };
  if (echoOffset !== undefined) result.offset = echoOffset;
  if (echoLimit !== undefined) result.limit = echoLimit;
  if (truncated) result.truncated = true;
  return result;
}
