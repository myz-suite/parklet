import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { startHttp, type HttpDeps } from './http.js';

type FakeHandle = () => Promise<unknown>;

function makeDeps(handle: FakeHandle): HttpDeps {
  return {
    config: {} as unknown as HttpDeps['config'],
    router: { handle } as unknown as HttpDeps['router'],
    events: { drain: () => [], unreadCount: () => 0 } as unknown as HttpDeps['events'],
    ledger: {} as unknown as HttpDeps['ledger'],
    isExtensionOnline: () => false,
    currentTabId: () => undefined,
  };
}

async function withServer(deps: HttpDeps, fn: (base: string) => Promise<void>): Promise<void> {
  const server = startHttp(deps);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('HTTP error responses', () => {
  it('returns the command-error shape for an unknown path', async () => {
    await withServer(
      makeDeps(async () => ({ id: '', result: { ok: true } })),
      async (base) => {
        const res = await fetch(`${base}/nope`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          error: { code: 'INVALID_REQUEST', message: 'not found' },
        });
      },
    );
  });

  it('returns the command-error shape on an internal failure', async () => {
    const deps = makeDeps(async () => {
      throw new Error('EACCES: permission denied, open ledger.jsonl');
    });
    await withServer(deps, async (base) => {
      const res = await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'get-status', params: {} }),
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: {
          code: 'INTERNAL',
          message: 'Error: EACCES: permission denied, open ledger.jsonl',
        },
      });
    });
  });
});
