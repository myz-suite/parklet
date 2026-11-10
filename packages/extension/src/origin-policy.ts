/** 浏览器禁止扩展脚本化的 origin 类别：用于把注入失败映射为 ORIGIN_BLOCKED。 */
export type BlockedOriginKind = 'webstore' | 'browser-page';

/**
 * 判断 URL 是否属于禁止扩展脚本化的 origin。
 *
 * - `webstore`：Chrome Web Store（新旧 host）——所有扩展脚本都被禁止；
 * - `browser-page`：浏览器内部页面（chrome: / chrome-extension: / devtools:）；
 * - 其余（含 `about:` 与拿不到 URL）返回 undefined，交给文案兜底。
 */
export function blockedOriginKind(url: string | undefined): BlockedOriginKind | undefined {
  if (url === undefined || url.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol === 'chrome:' ||
    parsed.protocol === 'chrome-extension:' ||
    parsed.protocol === 'devtools:'
  ) {
    return 'browser-page';
  }
  if (parsed.hostname === 'chromewebstore.google.com') return 'webstore';
  if (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) {
    return 'webstore';
  }
  return undefined;
}
