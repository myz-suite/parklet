import type { EventMessage } from '@parkinglot/protocol';

export interface CachedEvent {
  event: string;
  params: Record<string, unknown>;
  ts: string;
}

/** 计入未读/缓存的事件类型（仅 tab 生命周期，避免每次导航都刷屏）。 */
export const CACHED_EVENT_NAMES = ['tab.created', 'tab.removed'] as const;

export function isCachedEvent(event: EventMessage): boolean {
  return (CACHED_EVENT_NAMES as readonly string[]).includes(event.event);
}

/**
 * 事件缓存：内存保留最近 N 条 tab 生命周期事件，并维护未读数。
 * `drain()` 返回全部事件并清零（`plt events` 拉取后清空未读）。
 */
export class EventCache {
  private events: CachedEvent[] = [];
  private unread = 0;

  constructor(private readonly max = 100) {}

  push(event: EventMessage): void {
    this.events.push({ event: event.event, params: event.params, ts: new Date().toISOString() });
    if (this.events.length > this.max) this.events.shift();
    this.unread += 1;
  }

  unreadCount(): number {
    return this.unread;
  }

  size(): number {
    return this.events.length;
  }

  drain(): { events: CachedEvent[]; unreadCount: number } {
    const events = this.events;
    const unreadCount = this.unread;
    this.events = [];
    this.unread = 0;
    return { events, unreadCount };
  }
}
