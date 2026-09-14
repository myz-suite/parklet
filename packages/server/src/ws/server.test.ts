import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ExtensionHub } from './server.js';

let http: Server | undefined;

afterEach(async () => {
  if (http !== undefined) {
    const s = http;
    http = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

describe('ExtensionHub shutdown', () => {
  it('terminates active connections with 1001 and resolves promptly', async () => {
    const hub = new ExtensionHub('tok');
    http = createServer();
    hub.attach(http, '/ws');
    await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', () => resolve()));
    const port = (http.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'hello', token: 'tok' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(hub.isOnline()).toBe(true);

    const closeCode = new Promise<number>((resolve) =>
      client.once('close', (code) => resolve(code)),
    );
    const startedAt = Date.now();
    await hub.close();
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(await closeCode).toBe(1001);
    expect(hub.isOnline()).toBe(false);
  });
});
