import { describe, expect, it } from 'vitest';
import { markInjectionFailure, normalizeError } from './error-policy.js';

const WEBSTORE_MESSAGE =
  'this origin blocks all extension scripting; the route is closed — use the Chrome Web Store API or handle it manually';

describe('normalizeError', () => {
  it('keeps an existing protocol code and message unchanged', () => {
    const err = Object.assign(new Error('closed'), { code: 'EVAL_DISABLED', data: { a: 1 } });
    expect(normalizeError(err, 'https://example.com/')).toEqual({
      code: 'EVAL_DISABLED',
      message: 'closed',
      data: { a: 1 },
    });
  });

  it('maps an injection failure on the Chrome Web Store to ORIGIN_BLOCKED', () => {
    expect(
      normalizeError(
        markInjectionFailure(new Error('injection failed')),
        'https://chromewebstore.google.com/x',
      ),
    ).toEqual({
      code: 'ORIGIN_BLOCKED',
      message: WEBSTORE_MESSAGE,
    });
  });

  it('maps an injection failure on a browser page to ORIGIN_BLOCKED with a hint', () => {
    expect(
      normalizeError(markInjectionFailure(new Error('injection failed')), 'chrome://newtab/'),
    ).toEqual({
      code: 'ORIGIN_BLOCKED',
      message: 'cannot script browser-internal pages; run plt goto <http(s) url> to leave this page',
    });
  });

  it('falls back to the generic ORIGIN_BLOCKED message for a marked failure without a URL', () => {
    expect(normalizeError(markInjectionFailure(new Error('Cannot access a chrome:// URL')))).toEqual({
      code: 'ORIGIN_BLOCKED',
      message: 'this page blocks extension scripting; try another tab or handle it manually',
    });
  });

  it('never maps a non-injection failure on a protected origin to ORIGIN_BLOCKED', () => {
    expect(normalizeError(new Error('boom'), 'https://chromewebstore.google.com/x')).toEqual({
      code: 'INTERNAL',
      message: 'boom',
    });
  });

  it('keeps TAB_CLOSED for a vanished tab even on a protected origin', () => {
    expect(normalizeError(new Error('No tab with id: 42'), 'chrome://newtab/')).toEqual({
      code: 'TAB_CLOSED',
      message: 'No tab with id: 42',
    });
  });

  it('keeps INTERNAL on an ordinary page when the error has no code', () => {
    expect(normalizeError(new Error('boom'), 'https://example.com/')).toEqual({
      code: 'INTERNAL',
      message: 'boom',
    });
  });
});
