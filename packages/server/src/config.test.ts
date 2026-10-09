import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isHostAllowed, loadConfig, resolveDisabledCommands } from './config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pl-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ PARKLET_STATE_DIR: dir });
    expect(c.port).toBe(8787);
    expect(c.bind).toBe('127.0.0.1');
    expect(c.allowedHosts).toEqual([]);
    expect(c.disabledCommands).toEqual(['eval']);
    expect(c.enableEval).toBe(false);
    expect(c.commandTimeoutMs).toBe(30_000);
  });

  it('generates and persists a token to the state dir', () => {
    const c = loadConfig({ PARKLET_STATE_DIR: dir });
    expect(c.token).toMatch(/^[0-9a-f]{48}$/);
    expect(readFileSync(join(dir, 'token'), 'utf8').trim()).toBe(c.token);
  });

  it('reuses a persisted token across loads', () => {
    const a = loadConfig({ PARKLET_STATE_DIR: dir });
    const b = loadConfig({ PARKLET_STATE_DIR: dir });
    expect(a.token).toBe(b.token);
  });

  it('reads env overrides', () => {
    const c = loadConfig({
      PARKLET_STATE_DIR: dir,
      PARKLET_PORT: '9000',
      PARKLET_BIND: '0.0.0.0',
      PARKLET_ALLOWED_HOSTS: 'example.com, api.github.com',
      PARKLET_DISABLED_COMMANDS: 'eval, fetch',
      PARKLET_ENABLE_EVAL: '1',
      PARKLET_COMMAND_TIMEOUT_MS: '5000',
    });
    expect(c.port).toBe(9000);
    expect(c.bind).toBe('0.0.0.0');
    expect(c.allowedHosts).toEqual(['example.com', 'api.github.com']);
    expect(c.disabledCommands).toEqual(['eval', 'fetch']);
    // 显式禁用 eval 优先于 ENABLE_EVAL → 最终不可用
    expect(c.enableEval).toBe(false);
    expect(c.commandTimeoutMs).toBe(5000);
  });

  it('rejects invalid ports with a fallback', () => {
    const c = loadConfig({ PARKLET_STATE_DIR: dir, PARKLET_PORT: 'not-a-number' });
    expect(c.port).toBe(8787);
  });
});

describe('resolveDisabledCommands (eval gate)', () => {
  it('disables eval by default', () => {
    expect(resolveDisabledCommands({})).toEqual(['eval']);
  });

  it('enables eval when PARKLET_ENABLE_EVAL=1', () => {
    expect(resolveDisabledCommands({ PARKLET_ENABLE_EVAL: '1' })).toEqual([]);
  });

  it('explicit disable wins over PARKLET_ENABLE_EVAL', () => {
    expect(
      resolveDisabledCommands({
        PARKLET_DISABLED_COMMANDS: 'eval, fetch',
        PARKLET_ENABLE_EVAL: '1',
      }),
    ).toEqual(['eval', 'fetch']);
  });

  it('keeps eval disabled when a non-empty disable list omits it (breaking fix)', () => {
    expect(resolveDisabledCommands({ PARKLET_DISABLED_COMMANDS: 'fetch' })).toEqual([
      'fetch',
      'eval',
    ]);
  });

  it('enables eval with a non-eval disable list when explicitly opted in', () => {
    expect(
      resolveDisabledCommands({
        PARKLET_DISABLED_COMMANDS: 'fetch',
        PARKLET_ENABLE_EVAL: '1',
      }),
    ).toEqual(['fetch']);
  });
});

describe('isHostAllowed', () => {
  it('allows everything when no allowlist is configured', () => {
    expect(isHostAllowed('anything.example', [])).toBe(true);
  });

  it('matches hosts case-insensitively and ignores port', () => {
    const list = ['example.com'];
    expect(isHostAllowed('example.com', list)).toBe(true);
    expect(isHostAllowed('EXAMPLE.COM:443', list)).toBe(true);
    expect(isHostAllowed('evil.com', list)).toBe(false);
  });
});
