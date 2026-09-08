import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionRegistry } from './session.js';

let dir: string;
let registry: SessionRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pl-session-'));
  registry = new SessionRegistry(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SessionRegistry lifecycle', () => {
  it('creates a session with pl- id and auto mode by default', () => {
    const s = registry.create();
    expect(s.id).toMatch(/^pl-/);
    expect(s.mode).toBe('auto');
    expect(registry.get(s.id)).toBeDefined();
  });

  it('makes the first session the default', () => {
    const a = registry.create();
    expect(registry.getDefault()?.id).toBe(a.id);
    registry.create(); // 第二个 session 不抢占默认
    expect(registry.getDefault()?.id).toBe(a.id);
  });

  it('binds a tab on create and touch', () => {
    const s = registry.create({ tabId: 3 });
    expect(s.tabId).toBe(3);
    registry.touch(s.id, {
      tabId: 5,
      context: { url: 'https://x.com', title: 'X', navId: 1, tabId: 5 },
    });
    expect(registry.get(s.id)?.tabId).toBe(5);
    expect(registry.get(s.id)?.context?.navId).toBe(1);
  });

  it('close removes the session and clears default when needed', () => {
    const a = registry.create();
    const b = registry.create();
    expect(registry.close(a.id)).toBe(true);
    expect(registry.get(a.id)).toBeUndefined();
    // a 是默认 session：关闭后默认被清空（b 不会自动顶替）
    expect(registry.getDefault()).toBeUndefined();
    expect(registry.close(b.id)).toBe(true);
    expect(registry.getDefault()).toBeUndefined();
    expect(registry.close('nope')).toBe(false);
  });

  it('persists sessions and default across instances (state file)', () => {
    const a = registry.create({ tabId: 7, mode: 'ask' });
    const reloaded = new SessionRegistry(dir);
    expect(reloaded.get(a.id)?.tabId).toBe(7);
    expect(reloaded.get(a.id)?.mode).toBe('ask');
    expect(reloaded.getDefault()?.id).toBe(a.id);
  });

  it('tolerates a missing or corrupt state file', () => {
    const fresh = new SessionRegistry(join(dir, 'empty'));
    expect(fresh.list()).toEqual([]);
    fresh.create();
  });
});

describe('SessionRegistry resolve (addressing priority)', () => {
  it('prioritizes sessionId over tabId and defaults', () => {
    const s = registry.create({ tabId: 1 });
    const other = registry.create({ tabId: 2 });
    registry.setDefault(other.id);
    expect(registry.resolve({ sessionId: s.id })).toEqual({ sessionId: s.id, tabId: 1 });
  });

  it('uses explicit tabId without a session', () => {
    registry.create({ tabId: 1 });
    expect(registry.resolve({ tabId: 9 })).toEqual({ tabId: 9 });
  });

  it('falls back to the default session', () => {
    const s = registry.create({ tabId: 4 });
    expect(registry.resolve({})).toEqual({ sessionId: s.id, tabId: 4 });
  });

  it('falls back to the latest active tab when no session has a tab', () => {
    registry.create(); // session without tab
    expect(registry.resolve({}, 11)).toEqual({ tabId: 11 });
  });

  it('throws SESSION_NOT_FOUND for unknown sessionId', () => {
    expect(() => registry.resolve({ sessionId: 'pl-missing' })).toThrowError(/not found/);
  });

  it('throws SESSION_TAB_CLOSED when the session has no live tab', () => {
    const s = registry.create();
    expect(() => registry.resolve({ sessionId: s.id })).toThrowError(/no live tab/);
  });

  it('throws EXTENSION_NO_TAB when nothing is addressable', () => {
    expect(() => registry.resolve({})).toThrowError(/no tab targeted/);
  });
});
