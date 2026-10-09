/**
 * 协议错误码与错误类型。
 * 错误码是 wire 协议的一部分：extension 与 server 两侧都必须使用同一套枚举。
 */
export const ERROR_CODES = [
  // 信封/参数层
  'INVALID_REQUEST',
  'INVALID_PARAMS',
  'UNKNOWN_METHOD',
  'MESSAGE_TOO_LARGE',
  // 连接层
  'EXTENSION_OFFLINE',
  'EXTENSION_NO_TAB',
  // 寻址层
  'TAB_CLOSED',
  // 执行层
  'TIMEOUT',
  'TARGET_NOT_FOUND',
  'TARGET_AMBIGUOUS',
  'TAB_NOT_ACTIVE',
  'URL_INVALID',
  'HOST_NOT_ALLOWED',
  'EVAL_DISABLED',
  'NOT_SERIALIZABLE',
  // 兜底
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ProtocolErrorData {
  requestId?: string;
  [key: string]: unknown;
}

/** 协议层错误：携带稳定的机器可读 code，供 CLI/Agent 决策。 */
export class ParkletError extends Error {
  readonly code: ErrorCode;
  readonly data: ProtocolErrorData | undefined;

  constructor(code: ErrorCode, message: string, data?: ProtocolErrorData) {
    super(message);
    this.name = 'ParkletError';
    this.code = code;
    this.data = data;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
