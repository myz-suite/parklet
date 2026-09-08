import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 8787;
export const DEFAULT_BIND = '127.0.0.1';
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

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
  approvalTimeoutMs: number;
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

  const disabledCommands = envList(env, 'PARKINGLOT_DISABLED_COMMANDS');
  if (disabledCommands.length === 0) disabledCommands.push('eval');

  return {
    port: envInt(env, 'PARKINGLOT_PORT', DEFAULT_PORT),
    bind: env.PARKINGLOT_BIND?.trim() || DEFAULT_BIND,
    token,
    allowedHosts: envList(env, 'PARKINGLOT_ALLOWED_HOSTS'),
    disabledCommands,
    enableEval: env.PARKINGLOT_ENABLE_EVAL === '1',
    stateDir,
    commandTimeoutMs: envInt(env, 'PARKINGLOT_COMMAND_TIMEOUT_MS', DEFAULT_COMMAND_TIMEOUT_MS),
    approvalTimeoutMs: envInt(env, 'PARKINGLOT_APPROVAL_TIMEOUT_MS', DEFAULT_APPROVAL_TIMEOUT_MS),
  };
}

/** 域名白名单检查（host 不含端口）。 */
export function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true;
  const bare = host.toLowerCase().replace(/:\d+$/, '');
  return allowedHosts.some((h) => h.toLowerCase() === bare);
}
