import { describe, expect, it } from 'vitest';
import { blockedOriginKind } from './origin-policy.js';

describe('blockedOriginKind', () => {
  it.each([
    ['https://chromewebstore.google.com/detail/x', 'webstore'],
    ['https://chromewebstore.google.com/', 'webstore'],
    ['https://chrome.google.com/webstore/category/extensions', 'webstore'],
    ['https://chrome.google.com/webstore', 'webstore'],
  ])('detects the Chrome Web Store: %s', (url, expected) => {
    expect(blockedOriginKind(url)).toBe(expected);
  });

  it.each([
    ['chrome://newtab/', 'browser-page'],
    ['chrome-extension://abcdefghijklmnop/popup.html', 'browser-page'],
    ['devtools://devtools/bundled/inspector.html', 'browser-page'],
  ])('detects browser pages: %s', (url, expected) => {
    expect(blockedOriginKind(url)).toBe(expected);
  });

  it.each([
    'https://example.com/',
    'https://chrome.google.com/',
    'https://chrome.google.com/something',
    'about:blank',
    '',
    'not a url',
  ])('leaves ordinary or unknown URLs unclassified: %s', (url) => {
    expect(blockedOriginKind(url)).toBeUndefined();
  });

  it('leaves a missing URL unclassified', () => {
    expect(blockedOriginKind(undefined)).toBeUndefined();
  });
});
