import { describe, expect, it } from 'vitest';
import { isError, isEvent, isRequest, isResponse } from './envelope.js';

describe('envelope type guards', () => {
  it('recognizes a request', () => {
    expect(isRequest({ id: '1', method: 'goto', params: { url: 'https://example.com' } })).toBe(
      true,
    );
    expect(isRequest({ id: '1', method: 'ping' })).toBe(true);
  });

  it('rejects malformed requests', () => {
    expect(isRequest(null)).toBe(false);
    expect(isRequest({ id: '1' })).toBe(false);
    expect(isRequest({ id: 1, method: 'goto' })).toBe(false);
    expect(isRequest({ id: '1', method: 'goto', params: 'not-an-object' })).toBe(false);
  });

  it('recognizes a response with result envelope fields', () => {
    expect(
      isResponse({
        id: '1',
        result: {
          sessionId: 'pl-1',
          tabId: 7,
          context: { url: 'https://example.com', title: 'Ex', navId: 1, tabId: 7 },
          data: {},
        },
      }),
    ).toBe(true);
  });

  it('rejects responses missing data', () => {
    expect(isResponse({ id: '1', result: { context: undefined } })).toBe(false);
    expect(isResponse({ id: '1' })).toBe(false);
  });

  it('recognizes an error envelope', () => {
    expect(isError({ id: '1', error: { code: 'TIMEOUT', message: 'took too long' } })).toBe(true);
    expect(
      isError({
        id: '1',
        error: { code: 'EXTENSION_OFFLINE', message: 'offline', data: { retry: 3 } },
      }),
    ).toBe(true);
  });

  it('rejects errors with unknown shape', () => {
    expect(isError({ id: '1', error: { message: 'no code' } })).toBe(false);
    expect(isError({ id: '1', result: {} })).toBe(false);
  });

  it('recognizes an event', () => {
    expect(isEvent({ event: 'page.navigated', params: { url: 'https://x.com' } })).toBe(true);
  });

  it('rejects non-events', () => {
    expect(isEvent({ event: 'page.navigated' })).toBe(false);
    expect(isEvent({ method: 'goto' })).toBe(false);
  });

  it('disambiguates the message union', () => {
    const request = { id: '1', method: 'ping' };
    const response = { id: '1', result: { data: {} } };
    const error = { id: '1', error: { code: 'INTERNAL', message: 'x' } };
    const event = { event: 'extension.connected', params: {} };
    expect(
      isRequest(request) && !isResponse(request) && !isError(request) && !isEvent(request),
    ).toBe(true);
    expect(
      isResponse(response) && !isRequest(response) && !isError(response) && !isEvent(response),
    ).toBe(true);
    expect(isError(error) && !isRequest(error) && !isResponse(error) && !isEvent(error)).toBe(true);
    expect(isEvent(event) && !isRequest(event) && !isResponse(event) && !isError(event)).toBe(true);
  });
});
