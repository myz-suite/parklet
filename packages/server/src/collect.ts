import type { FieldSpec } from '@parklet/protocol';

/** collect 的 CLI 编排：复用 extract --fields 与 scroll，不新增 wire 命令。 */

export type CollectRow = Record<string, string | null>;

export interface CollectStep {
  index: number;
  newItems: number;
  totalItems: number;
  scroll: { before: number; after: number; delta: number };
  atBottom: boolean;
}

export interface CollectReport {
  items: CollectRow[];
  total: number;
  scrolls: number;
  duplicates: number;
  zeroNewSteps: number;
  stoppedReason: 'repeat-completed' | 'bottom' | 'max-items';
  steps: CollectStep[];
  observed?: { newest?: string; oldest?: string };
}

export interface CollectOptions {
  selector: string;
  fields: FieldSpec[];
  repeat: number;
  scrollBy?: number;
  maxItems: number;
  dedupe: boolean;
  /** 逗号分隔；缺省按 id / author,text / 全部字段推断 */
  dedupeKey?: string;
  dedupePrefix: number;
  focus: boolean;
  tabId?: number;
}

export type CollectSend = (
  method: string,
  params: Record<string, unknown>,
  tabId?: number,
) => Promise<Record<string, unknown>>;

interface ExtractFieldsData {
  mode?: string;
  items?: CollectRow[];
  total?: number;
}

interface ScrollData {
  before?: { y: number };
  after?: { y: number };
  delta?: { y: number };
  atBottom?: boolean;
}

interface PageInfoData {
  viewport?: { width: number; height: number };
}

function commandError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function fieldNames(fields: FieldSpec[]): string[] {
  return fields.map((f) => f.name);
}

function inferDedupeKey(fields: FieldSpec[]): string[] {
  const names = fieldNames(fields);
  if (names.includes('id')) return ['id'];
  if (names.includes('author') && names.includes('text')) return ['author', 'text'];
  return names;
}

function normalizeValue(value: string | null, prefix: number, key: string): string {
  const raw = value ?? '';
  // ids are identifiers, not text: never truncate them into a different id.
  if (prefix <= 0 || /(^|_)id$/i.test(key)) return raw;
  return raw.slice(0, prefix);
}

function dedupeKeyOf(row: CollectRow, keys: string[], prefix: number): string | undefined {
  const values = keys.map((key) => row[key] ?? null);
  // A missing key is not an empty string: keep the row instead of merging it.
  if (values.some((value) => value === null)) return undefined;
  return JSON.stringify(values.map((value, index) => normalizeValue(value, prefix, keys[index]!)));
}

function pickObserved(items: CollectRow[]): { newest?: string; oldest?: string } | undefined {
  let newest: number | undefined;
  let oldest: number | undefined;
  let newestText: string | undefined;
  let oldestText: string | undefined;
  for (const row of items) {
    const value = row.datetime;
    if (typeof value !== 'string' || value.length === 0) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    if (newest === undefined || ms > newest) {
      newest = ms;
      newestText = value;
    }
    if (oldest === undefined || ms < oldest) {
      oldest = ms;
      oldestText = value;
    }
  }
  if (newestText === undefined && oldestText === undefined) return undefined;
  return {
    ...(newestText !== undefined ? { newest: newestText } : {}),
    ...(oldestText !== undefined ? { oldest: oldestText } : {}),
  };
}

async function resolveTabId(
  send: CollectSend,
  explicit: number | undefined,
  focus: boolean,
): Promise<number | undefined> {
  if (!focus) return explicit;
  const status = await send('get-status', {});
  const current = status.currentTabId ?? status.latestTabId;
  const tabId = explicit ?? (typeof current === 'number' ? current : undefined);
  if (tabId === undefined) {
    throw commandError('EXTENSION_NO_TAB', 'collect --focus needs a target tab (use --tab)');
  }
  await send('activate-tab', { tabId }, tabId);
  return tabId;
}

export async function runCollect(
  send: CollectSend,
  options: CollectOptions,
): Promise<CollectReport> {
  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw commandError('INVALID_PARAMS', 'collect --repeat must be an integer >= 1');
  }
  if (options.scrollBy !== undefined && !(options.scrollBy > 0)) {
    throw commandError('INVALID_PARAMS', 'collect --scroll-by must be a positive number');
  }
  if (!Number.isInteger(options.maxItems) || options.maxItems < 1) {
    throw commandError('INVALID_PARAMS', 'collect --max-items must be an integer >= 1');
  }
  if (!Number.isInteger(options.dedupePrefix) || options.dedupePrefix < 0) {
    throw commandError('INVALID_PARAMS', 'collect --dedupe-prefix must be an integer >= 0');
  }

  const tabId = await resolveTabId(send, options.tabId, options.focus);
  const call = (method: string, params: Record<string, unknown>) => send(method, params, tabId);

  const info = (await call('get-page-info', {})) as PageInfoData;
  const viewportHeight = info.viewport?.height ?? 0;
  let scrollBy = options.scrollBy;
  if (scrollBy === undefined) {
    scrollBy = viewportHeight > 0 ? Math.max(1, Math.round(viewportHeight * 0.8)) : 600;
  } else if (viewportHeight > 0 && scrollBy > viewportHeight) {
    scrollBy = viewportHeight;
  }

  const initial = (await call('extract', {
    selector: options.selector,
    fields: options.fields,
  })) as ExtractFieldsData;

  const items: CollectRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const keys = options.dedupe
    ? options.dedupeKey !== undefined
      ? options.dedupeKey
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
      : inferDedupeKey(options.fields)
    : [];

  if (options.dedupe) {
    const names = new Set(fieldNames(options.fields));
    const unknown = keys.filter((key) => !names.has(key));
    if (unknown.length > 0) {
      throw commandError(
        'INVALID_PARAMS',
        `unknown dedupe key(s): ${unknown.join(', ')}; known fields: ${[...names].join(', ')}`,
      );
    }
  }

  const addRows = (rows: CollectRow[]): number => {
    let added = 0;
    for (const row of rows) {
      if (!options.dedupe) {
        items.push(row);
        added += 1;
      } else {
        const key = dedupeKeyOf(row, keys, options.dedupePrefix);
        if (key === undefined) {
          items.push(row);
          added += 1;
        } else if (seen.has(key)) {
          duplicates += 1;
          continue;
        } else {
          seen.add(key);
          items.push(row);
          added += 1;
        }
      }
      if (items.length >= options.maxItems) break;
    }
    return added;
  };

  addRows(initial.items ?? []);

  const steps: CollectStep[] = [];
  let stoppedReason: CollectReport['stoppedReason'] =
    items.length >= options.maxItems ? 'max-items' : 'repeat-completed';

  for (let index = 1; index <= options.repeat && stoppedReason !== 'max-items'; index += 1) {
    let scroll: ScrollData;
    try {
      scroll = (await call('scroll', { by: scrollBy })) as ScrollData;
    } catch (err) {
      const e = err as Error & { code?: string; data?: { atBottom?: boolean } };
      if (e.code === 'NO_EFFECT' && e.data?.atBottom === true) {
        stoppedReason = 'bottom';
        break;
      }
      throw err;
    }

    const extracted = (await call('extract', {
      selector: options.selector,
      fields: options.fields,
    })) as ExtractFieldsData;
    const newItems = addRows(extracted.items ?? []);
    const before = scroll.before?.y ?? 0;
    const after = scroll.after?.y ?? before;
    steps.push({
      index,
      newItems,
      totalItems: items.length,
      scroll: { before, after, delta: scroll.delta?.y ?? after - before },
      atBottom: scroll.atBottom === true,
    });

    if (items.length >= options.maxItems) {
      stoppedReason = 'max-items';
      break;
    }
    if (scroll.atBottom === true) {
      stoppedReason = 'bottom';
      break;
    }
  }

  const zeroNewSteps = steps.filter((s) => s.newItems === 0).length;
  const observed = pickObserved(items);
  return {
    items,
    total: items.length,
    scrolls: steps.length,
    duplicates,
    zeroNewSteps,
    stoppedReason,
    steps,
    ...(observed !== undefined ? { observed } : {}),
  };
}
