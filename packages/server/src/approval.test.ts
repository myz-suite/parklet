import { describe, expect, it } from 'vitest';
import { ApprovalManager } from './approval.js';
import type { Request } from '@parkinglot/protocol';

function makeRequest(overrides: Partial<Request> = {}): Request {
  return { id: 'r1', method: 'click', params: { selector: '#go' }, ...overrides };
}

describe('ApprovalManager', () => {
  it('resolves approved when accepted', async () => {
    const mgr = new ApprovalManager(10_000);
    const promise = mgr.request(makeRequest(), undefined);
    const pending = mgr.list();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.method).toBe('click');
    expect(mgr.respond(pending[0]!.requestId, true)).toBe(true);
    await expect(promise).resolves.toBe('approved');
    expect(mgr.list()).toHaveLength(0);
  });

  it('resolves denied when rejected', async () => {
    const mgr = new ApprovalManager(10_000);
    const promise = mgr.request(makeRequest(), 'pl-1');
    const [pending] = mgr.list();
    expect(mgr.respond(pending!.requestId, false)).toBe(true);
    await expect(promise).resolves.toBe('denied');
  });

  it('resolves timeout when nobody responds (fail-closed)', async () => {
    const mgr = new ApprovalManager(30);
    const promise = mgr.request(makeRequest(), undefined);
    await expect(promise).resolves.toBe('timeout');
    expect(mgr.list()).toHaveLength(0);
  });

  it('returns false for unknown requestId', () => {
    const mgr = new ApprovalManager(10_000);
    expect(mgr.respond('ap-missing', true)).toBe(false);
  });
});
