import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ledger, redactParams } from './ledger.js';

let dir: string;
let ledger: Ledger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pl-ledger-'));
  ledger = new Ledger(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('redactParams', () => {
  it('redacts sensitive keys while keeping the key name', () => {
    const out = redactParams({
      username: 'alice',
      password: 'hunter2',
      token: 'abc',
      headers: { authorization: 'Bearer x' },
    });
    expect(out.username).toBe('alice');
    expect(out.password).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    // headers 本身是敏感键 → 整体脱敏（可能含 authorization/cookie）
    expect(out.headers).toBe('[redacted]');
  });

  it('truncates long strings', () => {
    const out = redactParams({ url: `https://x.com/${'a'.repeat(500)}` });
    expect(typeof out.url).toBe('string');
    expect((out.url as string).length).toBeLessThan(300);
    expect((out.url as string).endsWith('…')).toBe(true);
  });

  it('redacts body and value payloads', () => {
    const out = redactParams({ body: '{"password":"secret"}', value: 'whatever' });
    expect(out.body).toBe('[redacted]');
    expect(out.value).toBe('[redacted]');
  });
});

describe('Ledger', () => {
  it('records and reads back entries in order', () => {
    ledger.record({ ts: 't1', id: '1', method: 'goto', params: {}, outcome: 'ok', durationMs: 10 });
    ledger.record({
      ts: 't2',
      id: '2',
      method: 'click',
      params: { selector: '#b' },
      outcome: 'error',
      code: 'TARGET_NOT_FOUND',
    });
    const entries = ledger.readTail(10);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.method).toBe('goto');
    expect(entries[1]?.code).toBe('TARGET_NOT_FOUND');
  });

  it('readTail limits the number of entries', () => {
    for (let i = 0; i < 10; i += 1) {
      ledger.record({ ts: String(i), id: String(i), method: 'ping', params: {}, outcome: 'ok' });
    }
    expect(ledger.readTail(3)).toHaveLength(3);
  });

  it('readNew returns only entries since the last read', () => {
    ledger.record({ ts: '1', id: '1', method: 'ping', params: {}, outcome: 'ok' });
    const first = ledger.readNew();
    expect(first).toHaveLength(1);
    ledger.record({ ts: '2', id: '2', method: 'ping', params: {}, outcome: 'ok' });
    const second = ledger.readNew();
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe('2');
    expect(ledger.readNew()).toHaveLength(0);
  });
});
