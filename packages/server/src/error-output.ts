import { isErrorCode, type ErrorCode, type ProtocolError } from '@parklet/protocol';

/**
 * 错误出口：把协议错误 / 本地异常统一成 `✖ [CODE] message`（或 `--json` 下的
 * `{"error":{"code","message"}}`），并给出稳定退出码。
 */

/** 协议错误码 → 进程退出码；未知或缺省按 1。 */
export function exitCodeFor(code: ErrorCode | undefined): number {
  switch (code) {
    case 'INVALID_REQUEST':
    case 'INVALID_PARAMS':
    case 'UNKNOWN_METHOD':
      return 2;
    case 'TAB_CLOSED':
    case 'ORIGIN_BLOCKED':
    case 'NO_EFFECT':
    case 'TARGET_NOT_FOUND':
    case 'TARGET_AMBIGUOUS':
    case 'TAB_NOT_ACTIVE':
    case 'URL_INVALID':
    case 'HOST_NOT_ALLOWED':
    case 'EVAL_DISABLED':
    case 'NOT_SERIALIZABLE':
      return 3;
    case 'EXTENSION_OFFLINE':
    case 'EXTENSION_NO_TAB':
      return 4;
    case 'TIMEOUT':
      return 6;
    default:
      return 1;
  }
}

/** 防御性归一化：旧 server 返回字符串或缺字段的对象时也能打印出 code + message。 */
function toOutputError(error: unknown): ProtocolError['error'] {
  if (typeof error === 'object' && error !== null) {
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      return { code: e.code as ErrorCode, message: e.message };
    }
  }
  return { code: 'INTERNAL', message: String(error) };
}

/** 错误输出的格式选项：`json` 决定打 `{"error":…}` 还是 `✖ [CODE] message`。 */
export interface OutputOpts {
  json?: boolean;
}

/** 打印协议错误（--json 时输出 `{"error":{code,message}}`）。 */
export function printError(error: unknown, opts: OutputOpts): void {
  const normalized = toOutputError(error);
  if (opts.json === true) console.log(JSON.stringify({ error: normalized }));
  else console.error(`✖ [${normalized.code}] ${normalized.message}`);
}

/** 打印 CLI 本地错误：保留错误自带的 code，否则用 fallback，并设置退出码。 */
export function reportLocalError(
  err: unknown,
  opts: Record<string, unknown>,
  fallback: ErrorCode,
  exitCode: number,
): void {
  const e = err as Error & { code?: string };
  const code: ErrorCode = e.code !== undefined && isErrorCode(e.code) ? e.code : fallback;
  if (opts.json === true) {
    console.log(JSON.stringify({ error: { code, message: e.message } }));
  } else {
    console.error(`✖ [${code}] ${e.message}`);
  }
  process.exitCode = exitCode;
}
