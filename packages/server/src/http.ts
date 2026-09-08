import { randomUUID } from 'node:crypto';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type ProtocolError,
  type Response,
} from '@parkinglot/protocol';
import type { ApprovalManager } from './approval.js';
import type { ServerConfig } from './config.js';
import type { Ledger } from './ledger.js';
import type { Router } from './router.js';
import type { SessionRegistry } from './session.js';

export const SERVER_NAME = 'parkinglot-server';
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface HttpDeps {
  config: ServerConfig;
  router: Router;
  registry: SessionRegistry;
  approval: ApprovalManager;
  ledger: Ledger;
  isExtensionOnline: () => boolean;
}

/**
 * 轻量 HTTP 端点（Agent 可选通道，与 CLI 共用同一 Router）：
 * - GET  /api/status
 * - POST /api/command
 * - POST /api/approve/:requestId
 * - GET  /api/ledger?tail=N
 */
export function startHttp(deps: HttpDeps): HttpServer {
  return createServer((req, res) => {
    void handle(req, res, deps);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: HttpDeps): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/status') {
      respondJson(res, 200, buildStatus(deps));
      return;
    }

    if (req.method === 'POST' && path === '/api/command') {
      const body = await readBody(req);
      if (body === null) {
        respondJson(res, 200, {
          id: '',
          error: {
            code: 'MESSAGE_TOO_LARGE',
            message: `request body exceeds ${MAX_BODY_BYTES} bytes`,
          },
        } satisfies ProtocolError);
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        respondJson(res, 200, {
          id: '',
          error: { code: 'INVALID_REQUEST', message: 'request body is not valid JSON' },
        } satisfies ProtocolError);
        return;
      }
      const envelope = payload as {
        method?: string;
        params?: unknown;
        sessionId?: string;
        tabId?: number;
      };
      const request = {
        id: randomUUID(),
        method: envelope.method,
        params: envelope.params,
        sessionId: envelope.sessionId,
        tabId: envelope.tabId,
      };
      const result = await deps.router.handle(request);
      respondJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && path === '/api/session') {
      const body = await readBody(req);
      let payload: { action?: string; id?: string; mode?: 'auto' | 'ask' };
      try {
        payload = body === null ? {} : (JSON.parse(body) as typeof payload);
      } catch {
        respondJson(res, 200, { ok: false, error: 'invalid body' });
        return;
      }
      const result = handleSessionAction(deps, payload);
      respondJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && path.startsWith('/api/approve/')) {
      const requestId = decodeURIComponent(path.slice('/api/approve/'.length));
      const body = await readBody(req);
      let approve = true;
      if (body !== null) {
        try {
          approve = (JSON.parse(body) as { approve?: boolean }).approve ?? true;
        } catch {
          respondJson(res, 200, { ok: false, error: 'invalid body' });
          return;
        }
      }
      const found = deps.approval.respond(requestId, approve);
      respondJson(res, 200, { ok: found, requestId, approved: approve });
      return;
    }

    if (req.method === 'GET' && path === '/api/ledger') {
      const tail = Math.min(
        Math.max(Number(url.searchParams.get('tail') ?? '100') || 100, 1),
        10_000,
      );
      respondJson(res, 200, { entries: deps.ledger.readTail(tail) });
      return;
    }

    respondJson(res, 404, { error: 'not found' });
  } catch (err) {
    respondJson(res, 500, { error: `internal: ${String(err)}` });
  }
}

function handleSessionAction(
  deps: HttpDeps,
  payload: { action?: string; id?: string; mode?: 'auto' | 'ask' },
): Record<string, unknown> {
  const { registry } = deps;
  switch (payload.action) {
    case 'new': {
      const session = registry.create({ mode: payload.mode ?? 'auto' });
      return { ok: true, session };
    }
    case 'use': {
      if (!payload.id) return { ok: false, error: 'id required' };
      if (!registry.setDefault(payload.id))
        return { ok: false, error: `session ${payload.id} not found` };
      return { ok: true, session: registry.get(payload.id) };
    }
    case 'close': {
      if (!payload.id) return { ok: false, error: 'id required' };
      return { ok: registry.close(payload.id), removed: true };
    }
    case 'mode': {
      if (!payload.id) return { ok: false, error: 'id required' };
      const ok = registry.setMode(payload.id, payload.mode ?? 'auto');
      return ok
        ? { ok: true, session: registry.get(payload.id) }
        : { ok: false, error: `session ${payload.id} not found` };
    }
    default:
      return {
        ok: false,
        error: `unknown action '${String(payload.action)}' (expected new|use|close|mode)`,
      };
  }
}

function buildStatus(deps: HttpDeps): Record<string, unknown> {
  const { config, registry, approval } = deps;
  return {
    server: { name: SERVER_NAME, protocol: PROTOCOL_NAME, protocolVersion: PROTOCOL_VERSION },
    extensionConnected: deps.isExtensionOnline(),
    sessions: registry.list(),
    defaultSessionId: registry.getDefault()?.id,
    pendingApprovals: approval.list(),
    config: {
      bind: config.bind,
      port: config.port,
      allowedHosts: config.allowedHosts,
      disabledCommands: config.disabledCommands,
      enableEval: config.enableEval,
      commandTimeoutMs: config.commandTimeoutMs,
      approvalTimeoutMs: config.approvalTimeoutMs,
    },
  };
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function respondJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export type { ProtocolError, Response };
