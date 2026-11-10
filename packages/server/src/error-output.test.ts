import { afterEach, describe, expect, it, vi } from 'vitest';
import { exitCodeFor, printError } from './error-output.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printError', () => {
  it('normalizes a plain string error to INTERNAL', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    printError('boom', {});
    expect(stderr).toHaveBeenCalledWith('✖ [INTERNAL] boom');
  });

  it('keeps code and message of a well-formed protocol error', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    printError({ code: 'TAB_CLOSED', message: 'closed' }, {});
    expect(stderr).toHaveBeenCalledWith('✖ [TAB_CLOSED] closed');
  });

  it('prints the same shape in --json mode', () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    printError({ code: 'TAB_CLOSED', message: 'closed' }, { json: true });
    expect(stdout).toHaveBeenCalledWith('{"error":{"code":"TAB_CLOSED","message":"closed"}}');
  });

  it('normalizes a malformed object to INTERNAL', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    printError({ nope: 1 }, {});
    expect(stderr).toHaveBeenCalledWith('✖ [INTERNAL] [object Object]');
  });
});

describe('exitCodeFor', () => {
  it('maps ORIGIN_BLOCKED to exit 3', () => {
    expect(exitCodeFor('ORIGIN_BLOCKED')).toBe(3);
  });

  it('maps INTERNAL to exit 1', () => {
    expect(exitCodeFor('INTERNAL')).toBe(1);
  });
});
