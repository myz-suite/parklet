import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventMessage, ProtocolError, Request, Response } from '@parkinglot/protocol';
import { ApprovalManager } from './approval.js';
import type { ServerConfig } from './config.js';
import { loadConfig } from './config.js';
import { Ledger } from './ledger.js';
import { Router, type RouterDeps, type RouterHub } from './router.js';
import { SessionRegistry } from './session.js';

class FakeHub implements RouterHub {
  online = true;
  latestTabId: number | undefined = 42;
  received: Request[] = [];
  events: EventMessage[] = [];
  responder: ((req: Request) => Response | ProtocolError) | undefined;

  isOnline(): boolean {
    return this.online;
  }
  getLatestTabId(): number | undefined {
    return this.latestTabId;
  }
  sendEvent(event: EventMessage): void {
    this.events.push(event);
  }
  async sendRequest(req: Request): Promise<Response | ProtocolError> {
    this.received.push(req);
    if (this.responder) return this.responder(req);
    return {
      id: req.id,
      result: {
        sessionId: req.sessionId,
        tabId: req.tabId,
        context: { url: 'https://example.com', title: 'Example', navId: 1, tabId: req.tabId ?? 1 },
        data: {},
      },
    };
  }
}

interface TestContext {
  config: ServerConfig;
  registry: SessionRegistry;
  ledger: Ledger;
  approval: ApprovalManager;
  hub: FakeHub;
  router: Router;
  dir: string;
}

let ctx: TestContext;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'pl-router-'));
  const config = loadConfig({ PARKINGLOT_STATE_DIR: dir, PARKINGLOT_APPROVAL_TIMEOUT_MS: '60' });
  const registry = new SessionRegistry(dir);
  const ledger = new Ledger(dir);
  const approval = new ApprovalManager(config.approvalTimeoutMs);
  const hub = new FakeHub();
  const router = new Router({ config, registry, hub, ledger, approval } satisfies RouterDeps);
  ctx = { config, registry, ledger, approval, hub, router, dir };
});

afterEach(() => {
  rmSync(ctx.dir, { recursive: true, force: true });
});

const valid = { id: '1', method: 'goto', params: { url: 'https://example.com' } };

describe('Router — validation', () => {
  it('rejects a malformed envelope', async () => {
    const res = await ctx.router.handle({ nope: true });
    expect('error' in res && res.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects invalid params', async () => {
    const res = await ctx.router.handle({ id: '1', method: 'goto', params: { url: 'nope' } });
    expect('error' in res && res.error.code).toBe('INVALID_PARAMS');
  });

  it('rejects disabled commands and eval', async () => {
    const disabled = await ctx.router.handle({
      id: '1',
      method: 'eval',
      params: { expression: '1' },
    });
    expect('error' in disabled && disabled.error.code).toBe('EVAL_DISABLED');
    const unknown = await ctx.router.handle({ id: '1', method: 'fly' });
    expect('error' in unknown && unknown.error.code).toBe('INVALID_REQUEST');
  });

  it('validates host allowlist when configured', async () => {
    ctx.config.allowedHosts = ['allowed.com'];
    const denied = await ctx.router.handle(valid);
    expect('error' in denied && denied.error.code).toBe('HOST_NOT_ALLOWED');
    const ok = await ctx.router.handle({
      id: '1',
      method: 'goto',
      params: { url: 'https://allowed.com/x' },
    });
    expect('error' in ok).toBe(false);
  });
});

describe('Router — targeting and session', () => {
  it('creates a session automatically on first goto and returns context', async () => {
    const res = await ctx.router.handle(valid);
    expect('result' in res).toBe(true);
    if ('result' in res) {
      expect(res.result.sessionId).toMatch(/^pl-/);
      expect(res.result.tabId).toBeDefined();
      expect(res.result.context?.navId).toBe(1);
    }
    expect(ctx.registry.list()).toHaveLength(1);
  });

  it('reuses the default session for subsequent commands', async () => {
    await ctx.router.handle(valid);
    const sessionId = ctx.registry.getDefault()!.id;
    const res = await ctx.router.handle({ id: '2', method: 'extract', params: {} });
    expect('result' in res && res.result.sessionId).toBe(sessionId);
    expect(ctx.hub.received[1]?.sessionId).toBe(sessionId);
  });

  it('errors with SESSION_NOT_FOUND for unknown sessionId', async () => {
    const res = await ctx.router.handle({
      id: '1',
      method: 'click',
      params: { selector: '#a' },
      sessionId: 'pl-missing',
    });
    expect('error' in res && res.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('targets the latest active tab when no session exists', async () => {
    const res = await ctx.router.handle({ id: '1', method: 'extract', params: {} });
    expect('result' in res && res.result.tabId).toBe(42);
  });

  it('reports EXTENSION_OFFLINE when the extension is not connected', async () => {
    ctx.hub.online = false;
    const res = await ctx.router.handle(valid);
    expect('error' in res && res.error.code).toBe('EXTENSION_OFFLINE');
  });

  it('serves ping and get-status locally even when the extension is offline', async () => {
    ctx.hub.online = false;
    const ping = await ctx.router.handle({ id: '1', method: 'ping', params: {} });
    expect('result' in ping).toBe(true);
    if ('result' in ping) {
      expect((ping.result.data as { extensionConnected?: boolean }).extensionConnected).toBe(false);
      expect((ping.result.data as { pong?: string }).pong).toBe('pong');
    }
    const status = await ctx.router.handle({ id: '2', method: 'get-status', params: {} });
    expect('result' in status).toBe(true);
  });
});

describe('Router — HITL (ask mode)', () => {
  async function sessionAskMode(): Promise<string> {
    await ctx.router.handle(valid);
    const id = ctx.registry.getDefault()!.id;
    ctx.registry.setMode(id, 'ask');
    return id;
  }

  it('parks write operations pending approval, then executes on approve', async () => {
    await sessionAskMode();
    const pending = ctx.router.handle({ id: '2', method: 'click', params: { selector: '#go' } });
    // 等待进入 pending
    await new Promise((r) => setTimeout(r, 10));
    const views = ctx.approval.list();
    expect(views).toHaveLength(1);
    ctx.approval.respond(views[0]!.requestId, true);
    const res = await pending;
    expect('result' in res).toBe(true);
  });

  it('returns APPROVAL_DENIED when rejected', async () => {
    await sessionAskMode();
    const pending = ctx.router.handle({ id: '2', method: 'click', params: { selector: '#go' } });
    await new Promise((r) => setTimeout(r, 10));
    const [view] = ctx.approval.list();
    ctx.approval.respond(view!.requestId, false);
    const res = await pending;
    expect('error' in res && res.error.code).toBe('APPROVAL_DENIED');
  });

  it('returns APPROVAL_TIMEOUT when nobody responds (fail-closed)', async () => {
    await sessionAskMode();
    const res = await ctx.router.handle({ id: '2', method: 'click', params: { selector: '#go' } });
    expect('error' in res && res.error.code).toBe('APPROVAL_TIMEOUT');
  });

  it('never parks read-only operations', async () => {
    await sessionAskMode();
    const res = await ctx.router.handle({ id: '2', method: 'extract', params: {} });
    expect('result' in res).toBe(true);
    expect(ctx.approval.list()).toHaveLength(0);
  });

  it('records HITL decisions in the ledger', async () => {
    await sessionAskMode();
    const res = await ctx.router.handle({ id: '2', method: 'click', params: { selector: '#go' } });
    expect('error' in res && res.error.code).toBe('APPROVAL_TIMEOUT');
    const outcomes = ctx.ledger.readTail(20).map((e) => e.outcome);
    expect(outcomes).toContain('pending');
    expect(outcomes).toContain('timeout');
  });
});

describe('Router — response normalization and ledger', () => {
  it('records ok entries and touches the session', async () => {
    await ctx.router.handle(valid);
    const id = ctx.registry.getDefault()!.id;
    await ctx.router.handle({ id: '2', method: 'extract', params: {} });
    const entries = ctx.ledger.readTail(10);
    expect(entries.map((e) => e.outcome)).toEqual(['ok', 'ok']);
    expect(ctx.registry.get(id)?.context?.navId).toBe(1);
  });

  it('propagates extension errors verbatim with the request id', async () => {
    ctx.hub.responder = (req) => ({
      id: req.id,
      error: { code: 'TARGET_NOT_FOUND', message: 'no such element' },
    });
    const res = await ctx.router.handle({
      id: '7',
      method: 'click',
      params: { selector: '#missing' },
    });
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('TARGET_NOT_FOUND');
      expect(res.id).toBe('7');
    }
  });
});
