import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type LedgerOutcome = 'ok' | 'error';

export interface LedgerEntry {
  ts: string;
  id: string;
  method: string;
  /** 已脱敏的参数（见 redactParams） */
  params: Record<string, unknown>;
  outcome: LedgerOutcome;
  code?: string;
  durationMs?: number;
  sessionId?: string;
  tabId?: number;
}

/** 敏感键：记录键名但不记值（body/value/headers 等可能含凭证或大负载，一律脱敏）。 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'token',
  'api_key',
  'apikey',
  'authorization',
  'cookie',
  'cookies',
  'secret',
  'private_key',
  'privatekey',
  'body',
  'value',
  'headers',
  'expression',
]);

const MAX_STRING = 256;

function truncateValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') {
    return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  }
  if (typeof v !== 'object' || v === null || depth <= 0) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => truncateValue(x, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) out[k] = '[redacted]';
    else out[k] = truncateValue(val, depth - 1);
  }
  return out;
}

/** 命令参数脱敏：敏感键只留键名，字符串截断到 256B。 */
export function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  return truncateValue(params, 2) as Record<string, unknown>;
}

/**
 * 命令账本：JSON lines 追加写，供 `pl logs` 与审计使用。
 * follow 通过轮询文件大小增量读取实现（v1 足够）。
 */
export class Ledger {
  private filePath: string;
  private lastSize = 0;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'ledger.jsonl');
    mkdirSync(stateDir, { recursive: true });
    if (existsSync(this.filePath)) this.lastSize = statSync(this.filePath).size;
  }

  record(entry: LedgerEntry): void {
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
    // 注意：不推进 lastSize —— readNew 需要感知新追加的字节
  }

  readTail(n = 100): LedgerEntry[] {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, 'utf8').trimEnd().split('\n');
    const entries: LedgerEntry[] = [];
    for (const line of lines.slice(-n)) {
      try {
        entries.push(JSON.parse(line) as LedgerEntry);
      } catch {
        // 跳过损坏行
      }
    }
    return entries;
  }

  /** 读取自上次 follow() 调用以来的新条目。 */
  readNew(): LedgerEntry[] {
    if (!existsSync(this.filePath)) return [];
    const size = statSync(this.filePath).size;
    if (size <= this.lastSize) return [];
    const buf = readFileSync(this.filePath);
    const lines = buf.toString('utf8', this.lastSize, size).trimEnd().split('\n');
    this.lastSize = size;
    const entries: LedgerEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LedgerEntry);
      } catch {
        // 跳过不完整/损坏行
      }
    }
    return entries;
  }
}
