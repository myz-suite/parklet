import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isHostAllowed, loadConfig } from './config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pl-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ PARKINGLOT_STATE_DIR: dir });
    expect(c.port).toBe(8787);
    expect(c.bind).toBe('127.0.0.1');
    expect(c.allowedHosts).toEqual([]);
    expect(c.disabledCommands).toEqual(['eval']);
    expect(c.enableEval).toBe(false);
    expect(c.commandTimeoutMs).toBe(30_000);
    expect(c.approvalTimeoutMs).toBe(60_000);
  });

  it('generates and persists a token to the state dir', () => {
    const c = loadConfig({ PARKINGLOT_STATE_DIR: dir });
    expect(c.token).toMatch(/^[0-9a-f]{48}$/);
    expect(readFileSync(join(dir, 'token'), 'utf8').trim()).toBe(c.token);
  });

  it('reuses a persisted token across loads', () => {
    const a = loadConfig({ PARKINGLOT_STATE_DIR: dir });
    const b = loadConfig({ PARKINGLOT_STATE_DIR: dir });
    expect(a.token).toBe(b.token);
  });

  it('reads env overrides', () => {
    const c = loadConfig({
      PARKINGLOT_STATE_DIR: dir,
      PARKINGLOT_PORT: '9000',
      PARKINGLOT_BIND: '0.0.0.0',
      PARKINGLOT_ALLOWED_HOSTS: 'example.com, api.github.com',
      PARKINGLOT_DISABLED_COMMANDS: 'eval, fetch',
      PARKINGLOT_ENABLE_EVAL: '1',
      PARKINGLOT_COMMAND_TIMEOUT_MS: '5000',
    });
    expect(c.port).toBe(9000);
    expect(c.bind).toBe('0.0.0.0');
    expect(c.allowedHosts).toEqual(['example.com', 'api.github.com']);
    expect(c.disabledCommands).toEqual(['eval', 'fetch']);
    expect(c.enableEval).toBe(true);
    expect(c.commandTimeoutMs).toBe(5000);
  });

  it('rejects invalid ports with a fallback', () => {
    const c = loadConfig({ PARKINGLOT_STATE_DIR: dir, PARKINGLOT_PORT: 'not-a-number' });
    expect(c.port).toBe(8787);
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
