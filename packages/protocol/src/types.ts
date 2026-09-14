/** 公共数据形状（wire 协议的一部分，两端共享）。 */

export interface Viewport {
  width: number;
  height: number;
}

/**
 * 上下文快照：每个命令响应都必须携带，Agent 据此自证"看到的是哪个页面"。
 * - url / title 变化 → 页面跳转了
 * - navId 递增 → 发生了导航（goto/back/forward/reload/SPA 路由，按实现能力）
 * - tabId 变化 → 焦点被切走
 */
export interface ContextSnapshot {
  url: string;
  title: string;
  navId: number;
  tabId: number;
}

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementInfo {
  tag: string;
  text?: string;
  attrs: Record<string, string>;
  box?: ElementBox;
}

/** extract structured 模式的 DOM 树节点。 */
export interface DomNode {
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children: DomNode[];
}

export interface PageSnapshot {
  context: ContextSnapshot;
  visibleText: string;
  viewport: Viewport;
  scrollY: number;
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export interface SessionInfo {
  id: string;
  tabId?: number;
  createdAt: string;
  lastUsedAt: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** search 的分页信息（哪一页的什么查询），便于 Agent 续取后续结果。 */
export interface SearchPagination {
  query: string;
  engine: string;
  page: number;
}

/** 定位器表示：CSS 选择器或可见文本（v1 两种，后续可扩展 css=/text=/role= 前缀）。 */
export type Locator = { type: 'css'; value: string } | { type: 'text'; value: string };
