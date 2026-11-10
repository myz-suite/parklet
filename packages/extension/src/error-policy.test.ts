import { describe, expect, it } from 'vitest';
import { normalizeError } from './error-policy.js';

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

  it('maps a Chrome Web Store tab to ORIGIN_BLOCKED', () => {
    expect(
      normalizeError(new Error('injection failed'), 'https://chromewebstore.google.com/x'),
    ).toEqual({
      code: 'ORIGIN_BLOCKED',
      message: WEBSTORE_MESSAGE,
    });
  });

  it('maps a browser page to ORIGIN_BLOCKED with a leave-the-page hint', () => {
    expect(normalizeError(new Error('injection failed'), 'chrome://newtab/')).toEqual({
      code: 'ORIGIN_BLOCKED',
      message:
        'cannot script browser-internal pages; run plt goto <http(s) url> to leave this page',
    });
  });

  it('falls back to the generic ORIGIN_BLOCKED message when only the text matches', () => {
    expect(normalizeError(new Error('Cannot access a chrome:// URL'), undefined)).toEqual({
      code: 'ORIGIN_BLOCKED',
      message: 'this page blocks extension scripting; try another tab or handle it manually',
    });
  });

  it('keeps TAB_CLOSED for a vanished tab', () => {
    expect(normalizeError(new Error('No tab with id: 42'), 'https://example.com/')).toEqual({
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
