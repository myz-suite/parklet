import {
  METHOD_META,
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
import type { ApprovalManager } from './approval.js';
import type { ServerConfig } from './config.js';
import { isHostAllowed } from './config.js';
import type { Ledger } from './ledger.js';
import { redactParams } from './ledger.js';
import type { ResolvedTarget, SessionRegistry } from './session.js';

/** Router 依赖的扩展连接抽象（ExtensionHub 实现，测试可注入 fake）。 */
export interface RouterHub {
  isOnline(): boolean;
  getLatestTabId(): number | undefined;
  sendRequest(req: Request, timeoutMs: number): Promise<Response | ProtocolError>;
  sendEvent(event: EventMessage): void;
}

export interface RouterDeps {
  config: ServerConfig;
  registry: SessionRegistry;
  hub: RouterHub;
  ledger: Ledger;
  approval: ApprovalManager;
}

/** 需要解析 tab 目标的命令（goto 单独处理：无 session 时允许 extension 自选激活 tab）。 */
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
  'scroll',
  'screenshot',
  'extract',
  'get-page-info',
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
 * 命令路由：校验 → 禁用检查 → 寻址 → HITL → 扩展在线检查 → 转发 → 归一化。
 * 每个命令（含 HITL 决策）写入命令账本。
 */
export class Router {
  constructor(private readonly deps: RouterDeps) {}

  async handle(raw: unknown): Promise<Response | ProtocolError> {
    const startedAt = Date.now();
    const ts = new Date().toISOString();

    // 1. 信封校验
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return this.error('INVALID_REQUEST', 'malformed request envelope', undefined, undefined);
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
      return this.error(code, `command '${req.method}' is disabled`, req.id, req.sessionId);
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
      return this.error(
        'INVALID_PARAMS',
        `invalid params for '${req.method}': ${detail}`,
        req.id,
        req.sessionId,
      );
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
        return this.error('URL_INVALID', `invalid URL: ${String(url)}`, req.id, req.sessionId);
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
          req.sessionId,
        );
      }
    }

    // 5. 目标解析
    let target: ResolvedTarget | undefined;
    if (NEEDS_TARGET.has(req.method)) {
      try {
        target = this.deps.registry.resolve(
          { sessionId: req.sessionId, tabId: req.tabId },
          this.deps.hub.getLatestTabId(),
        );
      } catch (err) {
        if (err instanceof ParkinglotError) {
          this.deps.ledger.record({
            ...base,
            outcome: 'error',
            code: err.code,
            durationMs: Date.now() - startedAt,
          });
          return this.error(err.code, err.message, req.id, req.sessionId);
        }
        throw err;
      }
    } else if (req.method === 'goto') {
      try {
        target = this.deps.registry.resolve(
          { sessionId: req.sessionId, tabId: req.tabId },
          this.deps.hub.getLatestTabId(),
        );
      } catch (err) {
        if (err instanceof ParkinglotError && err.code === 'EXTENSION_NO_TAB') {
          target = undefined; // 首次使用：extension 用激活 tab 导航
        } else if (err instanceof ParkinglotError) {
          this.deps.ledger.record({
            ...base,
            outcome: 'error',
            code: err.code,
            durationMs: Date.now() - startedAt,
          });
          return this.error(err.code, err.message, req.id, req.sessionId);
        } else {
          throw err;
        }
      }
    }

    // 6. HITL：ask 模式 + 写操作 → 挂起等待批准
    const session = target?.sessionId ? this.deps.registry.get(target.sessionId) : undefined;
    const writeAccess = METHOD_META[req.method].writeAccess;
    if (writeAccess !== 'never' && session?.mode === 'ask') {
      this.deps.ledger.record({ ...base, outcome: 'pending', sessionId: session.id });
      const outcome = await this.deps.approval.request(req, session.id, (view) => {
        // 推送 popup 批准队列
        this.deps.hub.sendEvent({
          event: 'approval.requested',
          params: { ...view },
        });
      });
      this.deps.ledger.record({
        ...base,
        outcome,
        sessionId: session.id,
        durationMs: Date.now() - startedAt,
      });
      if (outcome === 'timeout') {
        return this.error(
          'APPROVAL_TIMEOUT',
          'approval timed out; operation was not executed',
          req.id,
          session.id,
        );
      }
      if (outcome === 'denied') {
        return this.error('APPROVAL_DENIED', 'operation rejected by user', req.id, session.id);
      }
    }

    // 7. 扩展在线
    if (!EXTENSION_FREE.has(req.method) && !this.deps.hub.isOnline()) {
      this.deps.ledger.record({
        ...base,
        outcome: 'error',
        code: 'EXTENSION_OFFLINE',
        durationMs: Date.now() - startedAt,
      });
      return this.error('EXTENSION_OFFLINE', 'extension is not connected', req.id, req.sessionId);
    }

    // 8. 不依赖扩展的命令：server 本地处理（ping / get-status）
    if (EXTENSION_FREE.has(req.method)) {
      const local = this.handleLocal(req);
      this.deps.ledger.record({ ...base, outcome: 'ok', durationMs: Date.now() - startedAt });
      return local;
    }

    // 9. 转发（携带解析后的寻址目标）
    const wireReq: Request = {
      id: req.id,
      method: req.method,
      params,
      sessionId: target?.sessionId ?? req.sessionId,
      tabId: target?.tabId ?? req.tabId,
    };
    const res = await this.deps.hub.sendRequest(wireReq, this.deps.config.commandTimeoutMs);

    // 9. 归一化 + 会话状态回写
    if ('error' in res) {
      this.deps.ledger.record({
        ...base,
        outcome: 'error',
        code: res.error.code,
        sessionId: wireReq.sessionId,
        tabId: wireReq.tabId,
        durationMs: Date.now() - startedAt,
      });
      return res;
    }

    const { sessionId: resSessionId, tabId: resTabId, context } = res.result;
    let sessionId = resSessionId ?? wireReq.sessionId;
    if (sessionId === undefined && req.method === 'goto' && resTabId !== undefined) {
      // goto 且此前无 session → 自动创建并绑定
      const created = this.deps.registry.create({ tabId: resTabId });
      sessionId = created.id;
    }
    if (sessionId !== undefined) {
      this.deps.registry.touch(sessionId, { tabId: resTabId, context });
    }

    const finalRes: Response = {
      id: res.id,
      result: {
        sessionId,
        tabId: resTabId,
        context,
        data: res.result.data,
      },
    };
    this.deps.ledger.record({
      ...base,
      outcome: 'ok',
      sessionId,
      tabId: resTabId,
      durationMs: Date.now() - startedAt,
    });
    return finalRes;
  }

  private error(
    code: ProtocolError['error']['code'],
    message: string,
    requestId: string | undefined,
    sessionId: string | undefined,
  ): ProtocolError {
    const data: Record<string, unknown> = {};
    if (requestId !== undefined) data.requestId = requestId;
    if (sessionId !== undefined) data.sessionId = sessionId;
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
    const { config, registry } = this.deps;
    return {
      id: req.id,
      result: {
        data: {
          extensionConnected: this.deps.hub.isOnline(),
          sessions: registry.list(),
          config: {
            bind: config.bind,
            port: config.port,
            allowedHosts: config.allowedHosts,
            disabledCommands: config.disabledCommands,
            enableEval: config.enableEval,
            commandTimeoutMs: config.commandTimeoutMs,
            approvalTimeoutMs: config.approvalTimeoutMs,
          },
        },
      },
    };
  }
}
