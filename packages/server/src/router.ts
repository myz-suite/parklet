import {
  ParkinglotError,
  PROTOCOL_VERSION,
  requestSchema,
  validateParams,
  type EventMessage,
  type Method,
  type ProtocolError,
  type Request,
  type Response,
} from '@parkinglot/protocol';
import type { ServerConfig } from './config.js';
import { isHostAllowed } from './config.js';
import type { Ledger } from './ledger.js';
import { redactParams } from './ledger.js';
import type { TargetState } from './target.js';

/** Router 依赖的扩展连接抽象（ExtensionHub 实现，测试可注入 fake）。 */
export interface RouterHub {
  isOnline(): boolean;
  getLatestTabId(): number | undefined;
  sendRequest(req: Request, timeoutMs: number): Promise<Response | ProtocolError>;
  sendEvent(event: EventMessage): void;
}

export interface RouterDeps {
  config: ServerConfig;
  hub: RouterHub;
  ledger: Ledger;
  /** 当前目标 tab（软指针） */
  target: TargetState;
}

/** 需要解析 tab 目标的命令（goto 单独处理：无目标时允许 extension 用激活 tab）。 */
const NEEDS_TARGET: ReadonlySet<Method> = new Set([
  'back',
  'forward',
  'reload',
  'click',
  'click-text',
  'fill',
  'type',
  'press',
  'hover',
  'select',
  'selection',
  'scroll',
  'scroll-to',
  'screenshot',
  'extract',
  'get-page-info',
  'dom-query',
  'links',
  'forms',
  'fetch',
  'search',
  'wait',
  'eval',
]);

/** 携带 URL 的命令：server 层做第一道 host 白名单检查。 */
const URL_BEARING: ReadonlySet<Method> = new Set(['goto', 'create-tab', 'fetch']);

/** 不依赖扩展的命令：ping / get-status 只反映 server 自身状态。 */
const EXTENSION_FREE: ReadonlySet<Method> = new Set(['ping', 'get-status']);

function extractHost(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return new URL(raw).hostname;
  } catch {
    return undefined;
  }
}

/**
 * 命令路由：校验 → 禁用检查 → 寻址 → 扩展在线检查 → 转发 → 归一化。
 * 目标寻址：params.tabId > 当前目标 tab > 最近激活 tab（无 session 概念）。
 * 每个命令写入命令账本。
 */
export class Router {
  constructor(private readonly deps: RouterDeps) {}

  async handle(raw: unknown): Promise<Response | ProtocolError> {
    const startedAt = Date.now();
    const ts = new Date().toISOString();

    // 1. 信封校验
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return this.error('INVALID_REQUEST', 'malformed request envelope', undefined);
    }
    const req = parsed.data as Request;
    const base = {
      ts,
      id: req.id,
      method: req.method,
      params: redactParams((req.params ?? {}) as Record<string, unknown>),
    };

    // 2. 禁用命令
    if (this.deps.config.disabledCommands.includes(req.method)) {
      const code = req.method === 'eval' ? 'EVAL_DISABLED' : 'UNKNOWN_METHOD';
      this.deps.ledger.record({
        ...base,
        outcome: 'error',
        code,
        durationMs: Date.now() - startedAt,
      });
      return this.error(code, `command '${req.method}' is disabled`, req.id);
    }

    // 3. 参数校验
    const vp = validateParams(req.method, req.params);
    if (!vp.success) {
      const detail = vp.error.issues.map((i) => i.message).join('; ');
      this.deps.ledger.record({
        ...base,
        outcome: 'error',
        code: 'INVALID_PARAMS',
        durationMs: Date.now() - startedAt,
      });
      return this.error('INVALID_PARAMS', `invalid params for '${req.method}': ${detail}`, req.id);
    }
    const params = vp.data;

    // 4. host 白名单
    if (URL_BEARING.has(req.method)) {
      const url = (params as { url?: string }).url;
      const host = extractHost(url);
      if (host === undefined) {
        this.deps.ledger.record({
          ...base,
          outcome: 'error',
          code: 'URL_INVALID',
          durationMs: Date.now() - startedAt,
        });
        return this.error('URL_INVALID', `invalid URL: ${String(url)}`, req.id);
      }
      if (!isHostAllowed(host, this.deps.config.allowedHosts)) {
        this.deps.ledger.record({
          ...base,
          outcome: 'error',
          code: 'HOST_NOT_ALLOWED',
          durationMs: Date.now() - startedAt,
        });
        return this.error(
          'HOST_NOT_ALLOWED',
          `host '${host}' is not in PARKINGLOT_ALLOWED_HOSTS`,
          req.id,
        );
      }
    }

    // 5. 目标解析：显式 tabId > 当前目标 tab > 最近激活 tab
    let tabId: number | undefined;
    if (NEEDS_TARGET.has(req.method) || req.method === 'goto') {
      tabId = req.tabId ?? this.deps.target.get() ?? this.deps.hub.getLatestTabId();
      if (tabId === undefined && NEEDS_TARGET.has(req.method)) {
        this.deps.ledger.record({
          ...base,
          outcome: 'error',
          code: 'EXTENSION_NO_TAB',
          durationMs: Date.now() - startedAt,
        });
        return this.error(
          'EXTENSION_NO_TAB',
          'no tab to target: run `plt goto <url>` or pass --tab <id>',
          req.id,
        );
      }
    }

    // 6. 扩展在线
    if (!EXTENSION_FREE.has(req.method) && !this.deps.hub.isOnline()) {
      this.deps.ledger.record({
        ...base,
        outcome: 'error',
        code: 'EXTENSION_OFFLINE',
        durationMs: Date.now() - startedAt,
      });
      return this.error('EXTENSION_OFFLINE', 'extension is not connected', req.id);
    }

    // 7. 不依赖扩展的命令：server 本地处理（ping / get-status）
    if (EXTENSION_FREE.has(req.method)) {
      const local = this.handleLocal(req);
      this.deps.ledger.record({ ...base, outcome: 'ok', durationMs: Date.now() - startedAt });
      return local;
    }

    // 8. 转发（携带解析后的目标 tab）
    const wireReq: Request = { id: req.id, method: req.method, params, tabId };
    const res = await this.deps.hub.sendRequest(wireReq, this.deps.config.commandTimeoutMs);

    // 归一化 + 当前目标回写
    if ('error' in res) {
      // 目标 tab 已不存在 → 清除当前目标（不重试本次命令，避免重复副作用）
      if (res.error.code === 'TAB_CLOSED' && wireReq.tabId !== undefined) {
        this.deps.target.clearIf(wireReq.tabId);
      }
      this.deps.ledger.record({
        ...base,
        outcome: 'error',
        code: res.error.code,
        tabId: wireReq.tabId,
        durationMs: Date.now() - startedAt,
      });
      return res;
    }

    const { tabId: resTabId, context } = res.result;
    if (resTabId !== undefined) this.deps.target.set(resTabId);

    const finalRes: Response = {
      id: res.id,
      result: { tabId: resTabId, context, data: res.result.data },
    };
    this.deps.ledger.record({
      ...base,
      outcome: 'ok',
      tabId: resTabId,
      durationMs: Date.now() - startedAt,
    });
    return finalRes;
  }

  private error(
    code: ProtocolError['error']['code'],
    message: string,
    requestId: string | undefined,
  ): ProtocolError {
    const data: Record<string, unknown> = {};
    if (requestId !== undefined) data.requestId = requestId;
    return { id: requestId ?? 'server', error: { code, message, data } };
  }

  /** ping / get-status 的本地实现（不经过扩展）。 */
  private handleLocal(req: Request): Response {
    if (req.method === 'ping') {
      return {
        id: req.id,
        result: {
          data: {
            pong: 'pong',
            protocolVersion: PROTOCOL_VERSION,
            extensionConnected: this.deps.hub.isOnline(),
          },
        },
      };
    }
    const { config } = this.deps;
    return {
      id: req.id,
      result: {
        data: {
          extensionConnected: this.deps.hub.isOnline(),
          currentTabId: this.deps.target.get(),
          config: {
            bind: config.bind,
            port: config.port,
            allowedHosts: config.allowedHosts,
            disabledCommands: config.disabledCommands,
            enableEval: config.enableEval,
            commandTimeoutMs: config.commandTimeoutMs,
          },
        },
      },
    };
  }
}

export { ParkinglotError };
