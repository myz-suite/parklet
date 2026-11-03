import { describe, expect, it } from 'vitest';
import { runCollect, type CollectRow, type CollectSend } from './collect.js';

const ROW_HEIGHT = 100;
const WINDOW = 10;

function makeFeed(total = 30): {
  send: CollectSend;
  rows: CollectRow[];
  getY: () => number;
} {
  const rows: CollectRow[] = Array.from({ length: total }, (_, i) => ({
    id: String(i),
    author: `user${i % 3}`,
    datetime: new Date(Date.UTC(2026, 10, 3, 12, 0, 0) - i * 60_000).toISOString(),
    text: `tweet text ${i}`,
  }));
  let y = 0;
  const maxY = Math.max(0, (total - WINDOW) * ROW_HEIGHT);
  const send: CollectSend = async (method, params) => {
    if (method === 'get-status') return { currentTabId: 7 };
    if (method === 'activate-tab') return { tabId: params.tabId };
    if (method === 'get-page-info') return { viewport: { width: 800, height: 600 } };
    if (method === 'extract') {
      const start = Math.min(total, Math.floor(y / ROW_HEIGHT));
      return { mode: 'fields', items: rows.slice(start, start + WINDOW), total };
    }
    if (method === 'scroll') {
      const by = Number(params.by ?? 0);
      const before = y;
      const after = Math.min(maxY, y + by);
      if (after === before) {
        throw Object.assign(new Error('scroll had no effect'), {
          code: 'NO_EFFECT',
          data: { atBottom: true },
        });
      }
      y = after;
      return {
        before: { y: before },
        after: { y: after },
        delta: { y: after - before },
        atBottom: y >= maxY,
      };
    }
    throw new Error(`unexpected method ${method}`);
  };
  return { send, rows, getY: () => y };
}

const fields = [
  { name: 'id', selector: '.id' },
  { name: 'author', selector: '.author' },
  { name: 'datetime', selector: 'time', attr: 'datetime' },
  { name: 'text', selector: '.text' },
];

describe('runCollect', () => {
  it('collects a fixed number of scroll rounds and dedupes overlaps', async () => {
    const feed = makeFeed();
    const report = await runCollect(feed.send, {
      selector: 'article',
      fields,
      repeat: 3,
      scrollBy: 500,
      maxItems: 100,
      dedupe: true,
      dedupePrefix: 0,
      focus: true,
    });
    expect(report.scrolls).toBe(3);
    expect(report.steps).toHaveLength(3);
    expect(report.stoppedReason).toBe('repeat-completed');
    expect(report.duplicates).toBeGreaterThan(0);
    expect(report.total).toBe(report.items.length);
    expect(report.items.length).toBeGreaterThan(WINDOW);
    expect(report.observed?.newest).toBeDefined();
    expect(report.observed?.oldest).toBeDefined();
  });

  it('stops early at the bottom with NO_EFFECT', async () => {
    const feed = makeFeed(15);
    const report = await runCollect(feed.send, {
      selector: 'article',
      fields,
      repeat: 20,
      scrollBy: 500,
      maxItems: 100,
      dedupe: true,
      dedupePrefix: 0,
      focus: false,
    });
    expect(report.stoppedReason).toBe('bottom');
    expect(report.scrolls).toBeLessThan(20);
  });

  it('stops at max-items', async () => {
    const feed = makeFeed();
    const report = await runCollect(feed.send, {
      selector: 'article',
      fields,
      repeat: 10,
      scrollBy: 500,
      maxItems: 12,
      dedupe: true,
      dedupePrefix: 0,
      focus: false,
    });
    expect(report.stoppedReason).toBe('max-items');
    expect(report.total).toBeLessThanOrEqual(12);
  });

  it('does not scroll when the initial extraction already reaches max-items', async () => {
    const feed = makeFeed();
    const calls: string[] = [];
    const send: CollectSend = async (method, params, tabId) => {
      calls.push(method);
      return feed.send(method, params, tabId);
    };
    const report = await runCollect(send, {
      selector: 'article',
      fields,
      repeat: 10,
      maxItems: 5,
      dedupe: true,
      dedupePrefix: 0,
      focus: false,
    });
    expect(report.stoppedReason).toBe('max-items');
    expect(report.scrolls).toBe(0);
    expect(calls).not.toContain('scroll');
  });

  it('propagates NO_EFFECT when it is not at the bottom', async () => {
    const send: CollectSend = async (method) => {
      if (method === 'get-page-info') return { viewport: { width: 800, height: 600 } };
      if (method === 'extract') return { items: [] };
      if (method === 'scroll') {
        throw Object.assign(new Error('stuck'), {
          code: 'NO_EFFECT',
          data: { atBottom: false },
        });
      }
      return {};
    };
    await expect(
      runCollect(send, {
        selector: 'article',
        fields,
        repeat: 1,
        maxItems: 100,
        dedupe: true,
        dedupePrefix: 0,
        focus: false,
      }),
    ).rejects.toMatchObject({ code: 'NO_EFFECT' });
  });

  it('does not truncate id values with --dedupe-prefix', async () => {
    const rows: CollectRow[] = [
      { id: 'tweet-100', text: 'same' },
      { id: 'tweet-200', text: 'same' },
    ];
    const send: CollectSend = async (method) => {
      if (method === 'get-page-info') return { viewport: { width: 800, height: 600 } };
      if (method === 'extract') return { mode: 'fields', items: rows, total: rows.length };
      if (method === 'scroll') {
        throw Object.assign(new Error('scroll had no effect'), {
          code: 'NO_EFFECT',
          data: { atBottom: true },
        });
      }
      return {};
    };
    const report = await runCollect(send, {
      selector: 'article',
      fields: [
        { name: 'id', selector: '.id' },
        { name: 'text', selector: '.text' },
      ],
      repeat: 1,
      maxItems: 100,
      dedupe: true,
      dedupeKey: 'id',
      dedupePrefix: 3,
      focus: false,
    });
    expect(report.total).toBe(2);
    expect(report.duplicates).toBe(0);
  });

  it('keeps rows whose dedupe key is missing', async () => {
    const rows: CollectRow[] = [
      { id: '1', text: 'a' },
      { id: null, text: 'a' },
      { id: null, text: 'a' },
    ];
    const send: CollectSend = async (method) => {
      if (method === 'get-page-info') return { viewport: { width: 800, height: 600 } };
      if (method === 'extract') return { mode: 'fields', items: rows, total: rows.length };
      if (method === 'scroll') {
        throw Object.assign(new Error('scroll had no effect'), {
          code: 'NO_EFFECT',
          data: { atBottom: true },
        });
      }
      return {};
    };
    const report = await runCollect(send, {
      selector: 'article',
      fields: [
        { name: 'id', selector: '.id' },
        { name: 'text', selector: '.text' },
      ],
      repeat: 1,
      maxItems: 100,
      dedupe: true,
      dedupeKey: 'id',
      dedupePrefix: 0,
      focus: false,
    });
    expect(report.total).toBe(3);
    expect(report.duplicates).toBe(0);
  });

  it('rejects unknown dedupe keys instead of merging rows', async () => {
    const feed = makeFeed();
    await expect(
      runCollect(feed.send, {
        selector: 'article',
        fields,
        repeat: 1,
        maxItems: 100,
        dedupe: true,
        dedupeKey: 'auther',
        dedupePrefix: 0,
        focus: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('rejects repeat=0 and negative scroll', async () => {
    const feed = makeFeed();
    await expect(
      runCollect(feed.send, {
        selector: 'article',
        fields,
        repeat: 0,
        maxItems: 100,
        dedupe: true,
        dedupePrefix: 0,
        focus: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      runCollect(feed.send, {
        selector: 'article',
        fields,
        repeat: 1,
        scrollBy: -10,
        maxItems: 100,
        dedupe: true,
        dedupePrefix: 0,
        focus: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      runCollect(feed.send, {
        selector: 'article',
        fields,
        repeat: 1,
        maxItems: 100,
        dedupe: true,
        dedupePrefix: Number.NaN,
        focus: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('falls back to latestTabId for default focus', async () => {
    const feed = makeFeed();
    const seen: Array<{ method: string; tabId?: number }> = [];
    const send: CollectSend = async (method, params, tabId) => {
      seen.push({ method, tabId });
      if (method === 'get-status') return { latestTabId: 9 };
      return feed.send(method, params, tabId);
    };
    await runCollect(send, {
      selector: 'article',
      fields,
      repeat: 1,
      maxItems: 100,
      dedupe: true,
      dedupePrefix: 0,
      focus: true,
    });
    expect(seen.find((s) => s.method === 'activate-tab')?.tabId).toBe(9);
    expect(seen.find((s) => s.method === 'scroll')?.tabId).toBe(9);
  });

  it('clamps scroll-by to the viewport and focuses the target tab', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const feed = makeFeed();
    const send: CollectSend = async (method, params, tabId) => {
      calls.push({ method, params });
      return feed.send(method, params, tabId);
    };
    const report = await runCollect(send, {
      selector: 'article',
      fields,
      repeat: 1,
      scrollBy: 10_000,
      maxItems: 100,
      dedupe: true,
      dedupePrefix: 0,
      focus: true,
    });
    expect(report.scrolls).toBe(1);
    const scrollCall = calls.find((c) => c.method === 'scroll');
    expect(scrollCall?.params.by).toBe(600);
    expect(calls.some((c) => c.method === 'activate-tab')).toBe(true);
  });
});
