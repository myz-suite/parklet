import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  isError,
  isEvent,
  isResponse,
  ParkinglotError,
  type EventMessage,
  type ProtocolError,
  type Request,
  type Response,
} from '@parkinglot/protocol';

export const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MISSED_PONGS = 3;

interface PendingCall {
  resolve: (msg: Response | ProtocolError) => void;
  timer: NodeJS.Timeout;
}

interface HelloMessage {
  type: 'hello';
  token: string;
  extensionVersion?: string;
}

/**
 * 扩展连接枢纽：管理单个扩展的 WebSocket 连接（v1 单实例）。
 * - 握手：首条消息必须是 hello，token 匹配才认证
 * - 心跳：每 15s ping，连续 3 次无 pong 判定离线
 * - 命令往返：sendRequest 挂起按 id 等待响应，超时返回 TIMEOUT
 */
export class ExtensionHub extends EventEmitter {
  private wss: WebSocketServer | undefined;
  private conn: WebSocket | undefined;
  private authenticated = false;
  private pending = new Map<string, PendingCall>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private missedPongs = 0;
  private latestTabId: number | undefined;

  constructor(private readonly token: string) {
    super();
  }

  /** 绑定到 HTTP server 的 upgrade（与 /api/* 共用同一端口）。 */
  attach(server: HttpServer, path = '/'): void {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  isOnline(): boolean {
    return this.conn !== undefined && this.authenticated;
  }

  getLatestTabId(): number | undefined {
    return this.latestTabId;
  }

  /** 向扩展推送事件（如 approval.requested）。连接未就绪时静默丢弃。 */
  sendEvent(event: EventMessage): void {
    if (this.conn !== undefined && this.authenticated) {
      this.conn.send(JSON.stringify(event));
    }
  }

  /** 发送命令并等待响应；超时返回 TIMEOUT 错误信封。 */
  sendRequest(req: Request, timeoutMs: number): Promise<Response | ProtocolError> {
    const conn = this.conn;
    if (conn === undefined || !this.authenticated) {
      return Promise.resolve({
        id: req.id,
        error: {
          code: 'EXTENSION_OFFLINE',
          message:
            'extension is not connected: load the extension and pair it with the server token',
        },
      });
    }
    return new Promise<Response | ProtocolError>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        resolve({
          id: req.id,
          error: { code: 'TIMEOUT', message: `command timed out after ${timeoutMs}ms` },
        });
      }, timeoutMs);
      this.pending.set(req.id, { resolve, timer });
      try {
        conn.send(JSON.stringify(req));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(req.id);
        resolve({
          id: req.id,
          error: { code: 'EXTENSION_OFFLINE', message: `failed to send: ${String(err)}` },
        });
      }
    });
  }

  close(): Promise<void> {
    this.stopHeartbeat();
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer);
      resolve({
        id: '',
        error: { code: 'EXTENSION_OFFLINE', message: 'server shutting down' },
      });
    }
    this.pending.clear();
    return new Promise((resolve) => {
      if (this.wss === undefined) return resolve();
      this.wss.close(() => resolve());
    });
  }

  // -------------------------------------------------------------------------

  private handleConnection(ws: WebSocket): void {
    // 单实例：新连接替换旧连接
    if (this.conn !== undefined && this.authenticated) {
      this.conn.close(4001, 'replaced by a new connection');
      this.resetConnection();
    }

    this.conn = ws;
    this.authenticated = false;
    this.missedPongs = 0;

    ws.on('pong', () => {
      this.missedPongs = 0;
    });

    ws.on('message', (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        ws.close(4000, 'invalid JSON');
        return;
      }

      if (!this.authenticated) {
        this.handleHello(msg, ws);
        return;
      }

      if (isResponse(msg) || isError(msg)) {
        const call = this.pending.get(msg.id);
        if (call) {
          clearTimeout(call.timer);
          this.pending.delete(msg.id);
          call.resolve(msg);
        }
        return;
      }

      if (isEvent(msg)) {
        const event = msg as EventMessage;
        if (event.event === 'extension.tab-activated' && typeof event.params?.tabId === 'number') {
          this.latestTabId = event.params.tabId;
        }
        this.emit('event', event);
      }
    });

    ws.on('close', () => {
      if (this.conn === ws) this.resetConnection();
    });

    ws.on('error', () => {
      // 连接错误由 close 事件统一清理
    });

    this.startHeartbeat();
  }

  private handleHello(msg: unknown, ws: WebSocket): void {
    const hello = msg as Partial<HelloMessage>;
    if (hello?.type !== 'hello' || typeof hello.token !== 'string') {
      ws.close(4400, 'expected hello message with token');
      return;
    }
    if (hello.token !== this.token) {
      ws.close(4401, 'invalid token');
      return;
    }
    this.authenticated = true;
    ws.send(
      JSON.stringify({
        event: 'extension.connected',
        params: { extensionVersion: hello.extensionVersion },
      }),
    );
    this.emit('connected');
  }

  private resetConnection(): void {
    this.stopHeartbeat();
    this.conn = undefined;
    const wasAuthenticated = this.authenticated;
    this.authenticated = false;
    this.missedPongs = 0;
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer);
      resolve({
        id: '',
        error: { code: 'EXTENSION_OFFLINE', message: 'extension disconnected' },
      });
    }
    this.pending.clear();
    if (wasAuthenticated) this.emit('disconnected');
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.conn === undefined) return;
      if (this.missedPongs >= MAX_MISSED_PONGS) {
        this.conn.terminate();
        return;
      }
      this.missedPongs += 1;
      this.conn.ping();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

export function isHelloMessage(value: unknown): value is HelloMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === 'hello' && typeof v.token === 'string';
}

export function toExtensionOffline(id: string): ProtocolError {
  return {
    id,
    error: { code: 'EXTENSION_OFFLINE', message: 'extension not connected' },
  };
}

export { ParkinglotError };
