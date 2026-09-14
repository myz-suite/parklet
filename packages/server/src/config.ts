import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 8787;
export const DEFAULT_BIND = '127.0.0.1';
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export interface ServerConfig {
  port: number;
  bind: string;
  /** 扩展连接配对 token（默认持久化于 stateDir/token，自动生成） */
  token: string;
  /** 域名白名单（空 = 不限制） */
  allowedHosts: string[];
  /** 禁用的命令列表（默认含 eval） */
  disabledCommands: string[];
  enableEval: boolean;
  stateDir: string;
  commandTimeoutMs: number;
}

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envList(env: NodeJS.ProcessEnv, key: string): string[] {
  const raw = env[key];
  if (raw === undefined || raw === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 计算最终禁用命令列表。eval 门控优先级：
 * 1. `PARKINGLOT_DISABLED_COMMANDS` 显式包含 `eval` → 禁用（`PARKINGLOT_ENABLE_EVAL` 不能覆盖）
 * 2. 否则 `PARKINGLOT_ENABLE_EVAL=1` → 放行 eval
 * 3. 否则默认禁用 eval（即使 disable 列表非空但不含 eval）
 *
 * 注意：第 3 条是对旧行为的**破坏性安全修复**——旧实现仅当 disable 列表为空时才回填
 * `eval`，因此把 `PARKINGLOT_DISABLED_COMMANDS` 设为任意非 eval 值会**隐式放行 eval**。
 */
export function resolveDisabledCommands(env: NodeJS.ProcessEnv = process.env): string[] {
  const disabled = envList(env, 'PARKINGLOT_DISABLED_COMMANDS');
  if (disabled.includes('eval')) return disabled;
  if (env.PARKINGLOT_ENABLE_EVAL === '1') return disabled;
  return disabled.length === 0 ? ['eval'] : [...disabled, 'eval'];
}

/** 加载并校验配置。token 若未提供则生成并持久化到 stateDir/token（0600）。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const stateDir = env.PARKINGLOT_STATE_DIR ?? join(homedir(), '.parkinglot');
  mkdirSync(stateDir, { recursive: true });

  let token = env.PARKINGLOT_TOKEN?.trim();
  if (!token) {
    const tokenFile = join(stateDir, 'token');
    if (existsSync(tokenFile)) {
      token = readFileSync(tokenFile, 'utf8').trim();
    } else {
      token = randomBytes(24).toString('hex');
      writeFileSync(tokenFile, token, { mode: 0o600 });
    }
  }

  const disabledCommands = resolveDisabledCommands(env);

  return {
    port: envInt(env, 'PARKINGLOT_PORT', DEFAULT_PORT),
    bind: env.PARKINGLOT_BIND?.trim() || DEFAULT_BIND,
    token,
    allowedHosts: envList(env, 'PARKINGLOT_ALLOWED_HOSTS'),
    disabledCommands,
    // 反映 eval 的**最终**可用状态（显式禁用优先于 ENABLE_EVAL），供 status 展示
    enableEval: !disabledCommands.includes('eval'),
    stateDir,
    commandTimeoutMs: envInt(env, 'PARKINGLOT_COMMAND_TIMEOUT_MS', DEFAULT_COMMAND_TIMEOUT_MS),
  };
}

/** 域名白名单检查（host 不含端口）。 */
export function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true;
  const bare = host.toLowerCase().replace(/:\d+$/, '');
  return allowedHosts.some((h) => h.toLowerCase() === bare);
}
