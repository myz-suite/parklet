import type {
  DomNode,
  DomQueryMatch,
  ElementBox,
  ElementInfo,
  FormInfo,
  LinkInfo,
  PageSnapshot,
  SearchPagination,
  SearchResult,
  TabInfo,
  Viewport,
} from './types.js';

/**
 * 命令全集（v1）。method 名与 CLI 子命令一一对应（kebab-case）。
 * 分类：导航 / 交互 / 滚动截图 / 提取 / 页面内网络 / 标签页 / 等待 / 会话 / 高级。
 */
export const METHODS = [
  // 导航
  'goto',
  'back',
  'forward',
  'reload',
  // 交互
  'click',
  'click-text',
  'fill',
  'type',
  'press',
  'hover',
  'select',
  'selection',
  // 滚动 / 视图
  'scroll',
  'scroll-to',
  'screenshot',
  // 提取
  'extract',
  'get-page-info',
  'dom-query',
  // 页面内网络
  'fetch',
  'search',
  // 标签页
  'list-tabs',
  'create-tab',
  'close-tab',
  'activate-tab',
  // 等待
  'wait',
  // 会话
  'ping',
  'get-status',
  // 高级（默认禁用）
  'eval',
] as const;

export type Method = (typeof METHODS)[number];

/** 写操作分类（供审计/日志）：'always'=写操作；'never'=只读；'conditional'=视参数（fetch 的 HTTP method）。 */
export type WriteAccess = 'always' | 'never' | 'conditional';

export interface MethodMeta {
  writeAccess: WriteAccess;
  summary: string;
}

export const METHOD_META: Record<Method, MethodMeta> = {
  // 导航
  goto: { writeAccess: 'always', summary: '导航到指定 URL' },
  back: { writeAccess: 'always', summary: '后退到上一页' },
  forward: { writeAccess: 'always', summary: '前进到下一页' },
  reload: { writeAccess: 'always', summary: '重新加载当前页' },
  // 交互
  click: { writeAccess: 'always', summary: '按 CSS 选择器点击元素' },
  'click-text': { writeAccess: 'always', summary: '按可见文本点击元素' },
  fill: {
    writeAccess: 'always',
    summary: '填充输入框（整体替换；selector 可指向 label/容器，自动解析 input）',
  },
  type: {
    writeAccess: 'always',
    summary: '聚焦后逐键输入（selector 可指向 label/容器，自动解析 input）',
  },
  press: {
    writeAccess: 'always',
    summary: '按下键盘按键或组合键（Playwright 风格，如 Control+c）',
  },
  hover: { writeAccess: 'always', summary: '悬停在元素上' },
  select: { writeAccess: 'always', summary: '选择下拉选项' },
  selection: {
    writeAccess: 'always',
    summary: '按 selector 或可见文本选中页面文字并返回文本',
  },
  // 滚动 / 视图
  scroll: {
    writeAccess: 'always',
    summary: '滚动页面或元素（--by/--to；--selector 滚动元素内部）',
  },
  'scroll-to': { writeAccess: 'always', summary: '滚动页面使元素进入视口' },
  screenshot: { writeAccess: 'never', summary: '截图（viewport、整页或指定元素）' },
  // 提取
  extract: {
    writeAccess: 'never',
    summary: '提取页面文本 / DOM 树 / 文章正文 / 字段 / 链接 / 表单',
  },
  'get-page-info': { writeAccess: 'never', summary: '获取页面 URL/标题/视口/滚动位置' },
  'dom-query': {
    writeAccess: 'never',
    summary: '按 CSS 或可见文本查询元素并返回概要（探索用）',
  },
  // 页面内网络
  fetch: { writeAccess: 'conditional', summary: '在页面上下文发起网络请求（带登录态）' },
  search: { writeAccess: 'never', summary: '用搜索引擎查询并返回结果列表' },
  // 标签页
  'list-tabs': { writeAccess: 'never', summary: '列出所有标签页' },
  'create-tab': { writeAccess: 'always', summary: '新建标签页' },
  'close-tab': { writeAccess: 'always', summary: '关闭标签页' },
  'activate-tab': { writeAccess: 'always', summary: '激活（切换到）标签页' },
  // 等待
  wait: { writeAccess: 'never', summary: '等待时间/元素/加载条件' },
  // 会话
  ping: { writeAccess: 'never', summary: '连通性检查（pong + 版本）' },
  'get-status': { writeAccess: 'never', summary: '获取 server/扩展/session 状态摘要' },
  // 高级
  eval: { writeAccess: 'always', summary: '在页面上下文执行 JS（默认禁用）' },
};

// ---------------------------------------------------------------------------
// 每个命令的参数形状
// ---------------------------------------------------------------------------

export type NoopParams = Record<string, never>;

export interface GotoParams {
  url: string;
  waitUntil?: 'load' | 'domcontentloaded';
}

export interface ClickParams {
  selector: string;
}

export interface ClickTextParams {
  text: string;
  /** 限定作用域 */
  within?: string;
  /** 显式/隐式角色过滤（button/link/tab/...） */
  role?: string;
  /** 文本精确匹配（空白归一化后） */
  exact?: boolean;
  /** 候选（DOM 顺序）中的第 n 个，0-based */
  nth?: number;
}

export interface FillParams {
  selector: string;
  value: string;
}

export interface TypeParams {
  selector: string;
  text: string;
}

export interface PressParams {
  selector?: string;
  key: string;
}

export interface HoverParams {
  selector: string;
}

export interface SelectParams {
  selector: string;
  /** value 与 label 至少提供其一 */
  value?: string;
  label?: string;
}

export interface SelectionParams {
  /** selector 或可见文本 text 至少提供其一 */
  selector?: string;
  text?: string;
}

export interface ScrollParams {
  /** 滚动像素（正数向下，负数向上）；与 to 互斥，二选一必填 */
  by?: number;
  /** 跳到顶部/底部；与 by 互斥 */
  to?: 'top' | 'bottom';
  /** 提供则滚动该元素内部（overflow 容器），而不是页面 */
  selector?: string;
  /** 使用平滑滚动；默认 auto */
  smooth?: boolean;
  /** 等待滚动位置稳定；默认 true */
  settle?: boolean;
  /** 滚动前激活目标 tab（激活即 current） */
  focus?: boolean;
  /** 允许 delta=0；默认报 NO_EFFECT */
  allowNoop?: boolean;
}

export interface ScrollToParams {
  /** 滚动页面使该元素进入视口 */
  selector: string;
  smooth?: boolean;
  settle?: boolean;
  focus?: boolean;
}

export interface ScrollPosition {
  x: number;
  y: number;
}

export interface ScrollMetrics {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
}

/** scroll / scroll-to 的可验证结果：前后位置、真实增量、边界与可见性。 */
export interface ScrollResult {
  target: 'page' | { selector: string };
  before: ScrollPosition;
  after: ScrollPosition;
  delta: ScrollPosition;
  atTop: boolean;
  atBottom: boolean;
  settled: boolean;
  visibilityState: 'visible' | 'hidden';
  viewport: Viewport;
  warning?: 'BACKGROUND_TAB';
  metrics?: ScrollMetrics;
}

export interface ScrollToResult extends ScrollResult {
  element: ElementInfo;
}

export interface ScreenshotParams {
  format?: 'png' | 'jpeg';
  /** 元素截图：CSS 选择器；background 会自动激活目标 tab */
  selector?: string;
  /** 元素截图后恢复原来的 active tab */
  restoreFocus?: boolean;
  /** 由 CLI 侧解析后写入的本地路径（协议不负责写文件） */
  path?: string;
}

export interface FieldSpec {
  name: string;
  /** 行内字段选择器；优先使用 */
  selector: string;
  /** selector 未命中时按顺序尝试的备选选择器 */
  alternatives?: string[];
  /** 属性名；缺省或 `text` 表示取文本 */
  attr?: string;
}

export interface ExtractParams {
  /** text：整页/分段文本；structured：DOM 树；html：outerHTML；links/forms：链接/表单。默认 text。 */
  mode?: 'text' | 'structured' | 'html' | 'links' | 'forms';
  /** 结构化字段抽取（按行输出记录）；与 mode/article 互斥，需要 selector */
  fields?: FieldSpec[];
  /** article 模式（defuddle 正文提取）；与 mode 互斥；selector 同时提供时作为 contentSelector */
  article?: boolean;
  /** 提供 → 按 CSS 匹配；缺省 → 整页（text）/ body（structured）/ 自动检测（article） */
  selector?: string;
  /** 第一层列表跳过前 N 个（多 root=roots；单 root=其子元素） */
  offset?: number;
  /** 第一层列表最多 N 个（元素计数，恒语义一致） */
  limit?: number;
  /** 相对 root 递归深度，不含 root；默认 3 */
  depth?: number;
  /** 过滤第一层列表中不可见元素（子树照常） */
  visibleOnly?: boolean;
  /** text 模式每段文本字符截断（替代 v1 limit 的角色） */
  maxChars?: number;
  /** 提取前排除匹配该 CSS 的元素（及其子树） */
  exclude?: string;
}

export interface PageInfoParams {
  /** 可选：返回该 selector 的匹配数与首个元素 box */
  selector?: string;
}

export interface PageInfoResult {
  url: string;
  title: string;
  viewport: Viewport;
  scrollY: number;
  readyState: string;
  visibilityState: 'visible' | 'hidden';
  activeElement?: { tag: string; id?: string; role?: string };
  selection: string;
  scroll: {
    x: number;
    y: number;
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
  };
  /** 仅在 params.selector 提供时出现 */
  selector?: { count: number; box?: ElementBox };
}

export interface DomQueryParams {
  /** selector 或可见文本 text 至少提供其一 */
  selector?: string;
  text?: string;
  /** 最多返回多少条（default 20） */
  limit?: number;
}

export interface FetchParams {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  returnType?: 'text' | 'json' | 'binary';
}

export interface SearchParams {
  query: string;
  engine?: string;
  /** 结果页页码（1-based，默认 1；每页 ~10 条） */
  page?: number;
}

export interface CreateTabParams {
  url: string;
}

export interface CloseTabParams {
  tabId?: number;
}

export interface ActivateTabParams {
  tabId: number;
}

export interface WaitParams {
  /** ms / selector / condition 至少提供其一 */
  ms?: number;
  selector?: string;
  /** 等待匹配数量至少 N（默认 1） */
  count?: number;
  /** 数量在 N ms 内不变才算稳定 */
  stableMs?: number;
  condition?: 'networkidle' | 'load' | 'content';
}

export interface WaitResult {
  matched?: number;
  waitedMs: number;
  stable: boolean;
}

export interface EvalParams {
  /** 完整脚本，必须包含 return；默认禁用（PARKLET_ENABLE_EVAL=1 放行） */
  script: string;
}

export interface ParamsMap {
  // 导航
  goto: GotoParams;
  back: NoopParams;
  forward: NoopParams;
  reload: NoopParams;
  // 交互
  click: ClickParams;
  'click-text': ClickTextParams;
  fill: FillParams;
  type: TypeParams;
  press: PressParams;
  hover: HoverParams;
  select: SelectParams;
  selection: SelectionParams;
  // 滚动 / 视图
  scroll: ScrollParams;
  'scroll-to': ScrollToParams;
  screenshot: ScreenshotParams;
  // 提取
  extract: ExtractParams;
  'get-page-info': PageInfoParams;
  'dom-query': DomQueryParams;
  // 页面内网络
  fetch: FetchParams;
  search: SearchParams;
  // 标签页
  'list-tabs': NoopParams;
  'create-tab': CreateTabParams;
  'close-tab': CloseTabParams;
  'activate-tab': ActivateTabParams;
  // 等待
  wait: WaitParams;
  // 会话
  ping: NoopParams;
  'get-status': NoopParams;
  // 高级
  eval: EvalParams;
}

// ---------------------------------------------------------------------------
// 每个命令返回的 data 部分。
// sessionId 概念已移除：tabId / context 由信封统一携带（见 envelope.ts），data 只放命令特有结果。
// ---------------------------------------------------------------------------

export interface ElementActionResult {
  element: ElementInfo;
}

/** links 结果：分页作用在分组列表，total = 分组数。 */
export interface LinksResult {
  links: LinkInfo[];
  total: number;
  offset?: number;
  limit?: number;
  /** 采集阶段触碰硬上限（MAX_ITEMS）而被截断 */
  truncated?: boolean;
}

/** forms 结果：分页作用在字段（跨分组扁平计数），total = 字段总数。 */
export interface FormsResult {
  forms: FormInfo[];
  total: number;
  offset?: number;
  limit?: number;
  /** 采集阶段触碰硬上限（MAX_ITEMS）而被截断 */
  truncated?: boolean;
}

/**
 * extract 结果 = 按结果内 `mode` 判别的联合。
 * - `mode:'text'` + `snapshot`：无 selector，整页快照
 * - `mode:'text'` + `texts`：有 selector，每个匹配元素的文本（带 `total` 分页）
 * - `mode:'structured'` + `nodes`：DOM 树（带 `total` 分页，可 `truncated`）
 * - `mode:'html'` + `items`：按 selector 匹配元素的 `outerHTML`（带 `total` 分页）
 * - `mode:'article'`：defuddle 正文（由 params.article=true 触发，与 params.mode 无关）
 */
export type ExtractResult =
  | {
      mode: 'links';
      links: LinkInfo[];
      total: number;
      offset?: number;
      limit?: number;
      truncated?: boolean;
    }
  | {
      mode: 'forms';
      forms: FormInfo[];
      total: number;
      offset?: number;
      limit?: number;
      truncated?: boolean;
    }
  | { mode: 'text'; snapshot: PageSnapshot }
  | { mode: 'text'; texts: string[]; total: number; offset?: number; limit?: number }
  | {
      mode: 'structured';
      nodes: DomNode[];
      /** 第一层列表的元素总数（visibleOnly 过滤后、分页前） */
      total: number;
      offset?: number;
      limit?: number;
      truncated?: boolean;
    }
  | {
      mode: 'html';
      /** 每个匹配元素的 outerHTML（第一层列表；无文本截断） */
      items: string[];
      total: number;
      offset?: number;
      limit?: number;
    }
  | {
      mode: 'fields';
      /** 每行一条记录；缺失字段为 null */
      items: Array<Record<string, string | null>>;
      total: number;
      offset?: number;
      limit?: number;
    }
  | {
      mode: 'article';
      /** 正文（Markdown；defuddle/full 转换） */
      content: string;
      title?: string;
      author?: string;
      site?: string;
      description?: string;
      domain?: string;
      language?: string;
      url?: string;
      wordCount?: number;
    };

export interface ResultMap {
  // 导航 —— 产物即 context（信封层）
  goto: Record<string, never>;
  back: Record<string, never>;
  forward: Record<string, never>;
  reload: Record<string, never>;
  // 交互
  click: ElementActionResult;
  'click-text': ElementActionResult;
  fill: ElementActionResult;
  type: ElementActionResult;
  press: ElementActionResult;
  hover: ElementActionResult;
  select: ElementActionResult;
  selection: { text: string };
  // 滚动 / 视图
  scroll: ScrollResult;
  'scroll-to': ScrollToResult;
  screenshot: { data?: string; path?: string };
  // 提取
  extract: ExtractResult;
  'get-page-info': PageInfoResult;
  'dom-query': { matches: DomQueryMatch[]; total: number };
  // 页面内网络
  fetch: {
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    body: string;
  };
  search: { results: SearchResult[]; pagination?: SearchPagination };
  // 标签页
  'list-tabs': { tabs: TabInfo[] };
  'create-tab': { tab: TabInfo };
  'close-tab': Record<string, never>;
  'activate-tab': { tab: TabInfo };
  // 等待
  wait: WaitResult;
  // 会话
  ping: { pong: 'pong'; protocolVersion: string; extensionConnected: boolean };
  'get-status': {
    extensionConnected: boolean;
    currentTabId?: number;
    latestTabId?: number;
    config: Record<string, unknown>;
  };
  // 高级
  eval: { value?: unknown };
}

export type ParamsOf<M extends Method> = ParamsMap[M];
export type ResultOf<M extends Method> = ResultMap[M];
