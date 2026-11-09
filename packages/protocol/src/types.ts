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

/** links 命令：按 href 分组后的链接条目。 */
export interface LinkInfo {
  /** 解析后的绝对 URL（element.href） */
  href: string;
  /** 同一 href 下的文本，DOM 顺序，按精确字符串去重 */
  texts: string[];
  /** 该 href 在（visibleOnly 过滤后）结果中的出现次数 */
  count: number;
}

/** forms 命令：归一化后的表单字段。 */
export interface FormFieldInfo {
  /** input | select | textarea | button */
  tag: string;
  /** input.type / 'select' / 'textarea' / button.type */
  type: string;
  name?: string;
  /** 当前值（file 不回传；password 脱敏为 '********'） */
  value?: string;
  /** label[for] > 包裹 label > aria-label > placeholder */
  labels: string[];
  checked?: boolean;
  /** select 的已选项 value */
  selected?: string[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

/** forms 命令：按 action/method/target 分组后的表单。 */
export interface FormInfo {
  /** 缺省（无 form 归属）为 undefined */
  action?: string;
  /** 归一化大写，缺省 GET */
  method?: string;
  target?: string;
  fields: FormFieldInfo[];
}

/** dom-query 命令：单个匹配元素的概要（用于探索，不含子树）。 */
export interface DomQueryMatch {
  tag: string;
  class?: string;
  id?: string;
  text?: string;
  box?: ElementBox;
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
  /** server current target (may differ from the browser-active tab) */
  current?: boolean;
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
