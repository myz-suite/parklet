import type { ProtocolError } from '@parklet/protocol';
import { blockedOriginKind } from './origin-policy.js';

/** chrome.tabs 的"tab 已不存在"错误文案（不同路径措辞略有差异），统一映射为 TAB_CLOSED。 */
const TAB_GONE_RE = /no tab with id|invalid tab id|no tab with id:|tab was closed/i;

/** 页面禁止注入时的兜底文案（origin 判定拿不到 tab URL 时使用）。 */
const SCRIPTING_BLOCKED_RE = /cannot be scripted|cannot access a chrome:\/\/ url/i;

const ORIGIN_BLOCKED_MESSAGES = {
  webstore:
    'this origin blocks all extension scripting; the route is closed — use the Chrome Web Store API or handle it manually',
  'browser-page':
    'cannot script browser-internal pages; run plt goto <http(s) url> to leave this page',
  generic: 'this page blocks extension scripting; try another tab or handle it manually',
} as const;

export interface NormalizedError {
  code: ProtocolError['error']['code'];
  message: string;
  data?: Record<string, unknown>;
}

/**
 * 把命令抛出的任意错误归一化为协议错误。
 *
 * 判定顺序：已有的 `code` → origin-policy（按目标 tab URL）→ 注入失败文案兜底 →
 * tab 已关闭 → INTERNAL。`tabUrl` 取不到时跳过 origin 判定。
 */
export function normalizeError(err: unknown, tabUrl?: string): NormalizedError {
  const e = err as Error & { code?: string; data?: Record<string, unknown> };
  const message = e?.message ?? String(err);
  if (typeof e?.code === 'string') {
    return {
      code: e.code as ProtocolError['error']['code'],
      message,
      ...(e.data !== undefined ? { data: e.data } : {}),
    };
  }
  const kind = blockedOriginKind(tabUrl);
  if (kind === 'webstore' || kind === 'browser-page') {
    return { code: 'ORIGIN_BLOCKED', message: ORIGIN_BLOCKED_MESSAGES[kind] };
  }
  if (SCRIPTING_BLOCKED_RE.test(message)) {
    return { code: 'ORIGIN_BLOCKED', message: ORIGIN_BLOCKED_MESSAGES.generic };
  }
  if (TAB_GONE_RE.test(message)) {
    return { code: 'TAB_CLOSED', message };
  }
  return { code: 'INTERNAL', message };
}
