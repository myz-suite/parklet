import { describe, expect, it } from 'vitest';
import { EventCache, isCachedEvent } from './event-cache.js';

describe('isCachedEvent', () => {
  it('caches tab lifecycle events only', () => {
    expect(isCachedEvent({ event: 'tab.created', params: {} })).toBe(true);
    expect(isCachedEvent({ event: 'tab.removed', params: {} })).toBe(true);
    expect(isCachedEvent({ event: 'page.navigated', params: {} })).toBe(false);
    expect(isCachedEvent({ event: 'extension.tab-activated', params: {} })).toBe(false);
  });
});

describe('EventCache', () => {
  it('tracks unread count and drains on read', () => {
    const cache = new EventCache();
    cache.push({ event: 'tab.created', params: { tabId: 1, windowId: 2 } });
    cache.push({ event: 'tab.removed', params: { tabId: 1 } });
    expect(cache.unreadCount()).toBe(2);
    const drained = cache.drain();
    expect(drained.unreadCount).toBe(2);
    expect(drained.events).toHaveLength(2);
    expect(drained.events[0]).toMatchObject({ event: 'tab.created', params: { tabId: 1 } });
    expect(cache.unreadCount()).toBe(0);
    expect(cache.drain().events).toEqual([]);
  });

  it('keeps only the most recent N events', () => {
    const cache = new EventCache(3);
    for (let i = 0; i < 5; i += 1) {
      cache.push({ event: 'tab.created', params: { tabId: i } });
    }
    const drained = cache.drain();
    expect(drained.events.map((e) => e.params.tabId)).toEqual([2, 3, 4]);
    expect(drained.unreadCount).toBe(5);
  });
});
