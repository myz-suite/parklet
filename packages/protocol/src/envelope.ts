import type { ErrorCode } from './errors.js';
import type { Method, ParamsMap, ResultMap } from './methods.js';
import type { ContextSnapshot } from './types.js';

/**
 * 请求信封。params 可省略（NoopParams 命令）。
 * tabId 为 server 寻址后注入的目标字段（与 Response 信封对称），
 * CLI/HTTP 客户端可选传入；extension 收到的请求总是携带已解析的目标。
 */
export interface Request<M extends Method = Method> {
  id: string;
  method: M;
  params?: ParamsMap[M];
  tabId?: number;
}

/**
 * 命令结果信封。公共字段统一携带寻址与连续性信息：
 * - tabId：本次命令实际作用的标签页（寻址解析结果）
 * - context：页面上下文快照（url/title/navId）——Agent 连续性的"自证"
 * data 存放命令特有结果。
 */
export interface CommandResult<M extends Method = Method> {
  tabId?: number;
  context?: ContextSnapshot;
  data: ResultMap[M];
}

export interface Response<M extends Method = Method> {
  id: string;
  result: CommandResult<M>;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  data?: Record<string, unknown>;
}

/** 错误信封（Response 的失败形态，与成功 Response 共用 id）。 */
export interface ProtocolError {
  id: string;
  error: ErrorBody;
}

export const EVENT_NAMES = [
  'extension.connected',
  'extension.disconnected',
  'extension.tab-activated',
  'page.navigated',
  'tab.created',
  'tab.removed',
  // Network.* 为扩展点：v1 不实现页面级网络事件
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** 事件消息（extension → server，server 按需转发给订阅方）。 */
export interface EventMessage {
  event: EventName;
  params: Record<string, unknown>;
}

export type Message = Request | Response | ProtocolError | EventMessage;

// ---------------------------------------------------------------------------
// 类型守卫（wire 层判别，供 WS/HTTP 消息路由使用）
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isRequest(value: unknown): value is Request {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.method === 'string' &&
    (value.params === undefined || isRecord(value.params))
  );
}

export function isResponse(value: unknown): value is Response {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isRecord(value.result) &&
    'data' in value.result
  );
}

export function isError(value: unknown): value is ProtocolError {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  );
}

export function isEvent(value: unknown): value is EventMessage {
  return isRecord(value) && typeof value.event === 'string' && isRecord(value.params);
}
