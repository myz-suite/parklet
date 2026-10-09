/**
 * @parklet/extension — Chrome Manifest V3 扩展。
 *
 * Phase 4 将在此实现：background service worker（WebSocket 客户端/路由/navId 追踪）、
 * content script 页面执行器（定位器/交互/提取/截图/滚动）、popup 控制台。构建切到 esbuild。
 */
export const EXTENSION_NAME = 'parklet-extension' as const;

export function extensionName(): string {
  return EXTENSION_NAME;
}
