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
} from '@parklet/protocol';
import type { ServerConfig } from './config.js';
import type { EventCache } from './event-cache.js';
import type { Ledger } from './ledger.js';
import type { Router } from './router.js';

export const SERVER_NAME = 'parklet-server';
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface HttpDeps {
  config: ServerConfig;
  router: Router;
  events: EventCache;
  ledger: Ledger;
  isExtensionOnline: () => boolean;
  currentTabId: () => number | undefined;
}

/**
 * 轻量 HTTP 端点（Agent 可选通道，与 CLI 共用同一 Router）：
 * - GET  /api/status
 * - POST /api/command
 * - GET  /api/events          （拉取 tab 生命周期事件并清空未读）
 * - GET  /api/ledger?tail=N
 */
export function startHttp(deps: HttpDeps): HttpServer {
  return createServer((req, res) => {
    void handle(req, res, deps);
  });
}

/** 处理单个 HTTP 请求：路由到命令/事件/账本端点，兜底写统一 JSON 错误。 */
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
        tabId?: number;
      };
      const request = {
        id: randomUUID(),
        method: envelope.method,
        params: envelope.params,
        tabId: envelope.tabId,
      };
      const result = await deps.router.handle(request);
      // 成功响应附带未读事件数（供 CLI 展示；失败响应不带）
      respondJson(
        res,
        200,
        'result' in result
          ? { ...result, result: { ...result.result, unreadCount: deps.events.unreadCount() } }
          : result,
      );
      return;
    }

    if (req.method === 'GET' && path === '/api/events') {
      respondJson(res, 200, deps.events.drain());
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

    respondJson(res, 404, { error: { code: 'INVALID_REQUEST', message: 'not found' } });
  } catch (err) {
    respondJson(res, 500, { error: { code: 'INTERNAL', message: String(err) } });
  }
}

function buildStatus(deps: HttpDeps): Record<string, unknown> {
  const { config } = deps;
  return {
    server: { name: SERVER_NAME, protocol: PROTOCOL_NAME, protocolVersion: PROTOCOL_VERSION },
    extensionConnected: deps.isExtensionOnline(),
    currentTabId: deps.currentTabId(),
    config: {
      bind: config.bind,
      port: config.port,
      allowedHosts: config.allowedHosts,
      disabledCommands: config.disabledCommands,
      enableEval: config.enableEval,
      commandTimeoutMs: config.commandTimeoutMs,
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

/** 统一 JSON 响应：写状态码、Content-Type 与 Content-Length 后结束请求。 */
export function respondJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export type { ProtocolError, Response };
