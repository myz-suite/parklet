import { describe, expect, it } from 'vitest';
import { ERROR_CODES, isErrorCode } from './errors.js';
import { EVENT_NAMES } from './envelope.js';
import {
  errorSchema,
  eventSchema,
  requestSchema,
  responseSchema,
  validateParams,
} from './schemas.js';
import { METHODS } from './methods.js';

describe('requestSchema', () => {
  it('accepts a valid request', () => {
    const r = requestSchema.safeParse({
      id: '1',
      method: 'goto',
      params: { url: 'https://example.com' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts a request without params', () => {
    const r = requestSchema.safeParse({ id: '1', method: 'ping' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown method', () => {
    const r = requestSchema.safeParse({ id: '1', method: 'fly-to-moon' });
    expect(r.success).toBe(false);
  });

  it('rejects empty id', () => {
    const r = requestSchema.safeParse({ id: '', method: 'ping' });
    expect(r.success).toBe(false);
  });
});

describe('validateParams', () => {
  it('validates goto url strictly', () => {
    expect(validateParams('goto', { url: 'https://example.com' }).success).toBe(true);
    expect(validateParams('goto', { url: 'not-a-url' }).success).toBe(false);
    expect(validateParams('goto', {}).success).toBe(false);
  });

  it('strips unknown params (Postel: receive liberally)', () => {
    const r = validateParams('click', { selector: '#btn', extra: 'ignored' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ selector: '#btn' });
      expect('extra' in r.data).toBe(false);
    }
  });

  it('accepts missing params for noop commands', () => {
    expect(validateParams('ping', undefined).success).toBe(true);
    expect(validateParams('ping', {}).success).toBe(true);
    expect(validateParams('list-tabs', undefined).success).toBe(true);
  });

  it('requires value or label for select', () => {
    expect(validateParams('select', { selector: '#s' }).success).toBe(false);
    expect(validateParams('select', { selector: '#s', value: '1' }).success).toBe(true);
    expect(validateParams('select', { selector: '#s', label: 'One' }).success).toBe(true);
  });

  it('requires at least one target for scroll', () => {
    expect(validateParams('scroll', {}).success).toBe(false);
    expect(validateParams('scroll', { direction: 'down' }).success).toBe(true);
    expect(validateParams('scroll', { amount: 300 }).success).toBe(true);
    expect(validateParams('scroll', { selector: '#main' }).success).toBe(true);
    expect(validateParams('scroll', { direction: 'sideways' }).success).toBe(false);
  });

  it('requires at least one condition for wait', () => {
    expect(validateParams('wait', {}).success).toBe(false);
    expect(validateParams('wait', { ms: 100 }).success).toBe(true);
    expect(validateParams('wait', { selector: '#done' }).success).toBe(true);
    expect(validateParams('wait', { condition: 'networkidle' }).success).toBe(true);
  });

  it('validates every declared method against its schema', () => {
    // 所有 method 都有 schema（完整性由 paramsSchemas satisfies 映射在编译期保证），
    // 这里抽查每个 method 空参数至少不抛异常（成功与否按规则）。
    for (const m of METHODS) {
      expect(() => validateParams(m, {})).not.toThrow();
    }
  });
});

describe('response / error / event schemas', () => {
  it('validates a response with context snapshot', () => {
    const r = responseSchema.safeParse({
      id: '1',
      result: {
        sessionId: 'pl-1',
        tabId: 7,
        context: { url: 'https://example.com', title: 'Ex', navId: 2, tabId: 7 },
        data: { value: 42 },
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects a response without data', () => {
    const r = responseSchema.safeParse({ id: '1', result: { context: undefined } });
    expect(r.success).toBe(false);
  });

  it('validates every declared error code', () => {
    for (const code of ERROR_CODES) {
      const r = errorSchema.safeParse({ id: '1', error: { code, message: 'm' } });
      expect(r.success).toBe(true);
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it('rejects unknown error code', () => {
    const r = errorSchema.safeParse({ id: '1', error: { code: 'NOT_A_CODE', message: 'm' } });
    expect(r.success).toBe(false);
  });

  it('validates declared events', () => {
    for (const event of EVENT_NAMES) {
      const r = eventSchema.safeParse({ event, params: {} });
      expect(r.success).toBe(true);
    }
  });

  it('rejects unknown event', () => {
    const r = eventSchema.safeParse({ event: 'spooky.ghost', params: {} });
    expect(r.success).toBe(false);
  });
});
