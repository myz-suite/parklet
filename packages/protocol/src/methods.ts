import type {
  ElementInfo,
  PageSnapshot,
  SearchResult,
  SessionInfo,
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
  // 滚动 / 视图
  'scroll',
  'screenshot',
  // 提取
  'extract',
  'get-page-info',
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

/** HITL 分类：'always'=写操作需批准；'never'=只读；'conditional'=视参数（fetch 的 HTTP method）。 */
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
  fill: { writeAccess: 'always', summary: '填充输入框（整体替换）' },
  type: { writeAccess: 'always', summary: '聚焦后逐键输入' },
  press: { writeAccess: 'always', summary: '按下键盘按键' },
  hover: { writeAccess: 'always', summary: '悬停在元素上' },
  select: { writeAccess: 'always', summary: '选择下拉选项' },
  // 滚动 / 视图
  scroll: { writeAccess: 'always', summary: '滚动页面或元素' },
  screenshot: { writeAccess: 'never', summary: '截图（viewport 或整页）' },
  // 提取
  extract: { writeAccess: 'never', summary: '提取页面可读文本快照' },
  'get-page-info': { writeAccess: 'never', summary: '获取页面 URL/标题/视口/滚动位置' },
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

export interface ScrollParams {
  /** direction 与 amount 二选一；提供 selector 则滚动该元素 */
  direction?: 'up' | 'down' | 'top' | 'bottom';
  amount?: number;
  selector?: string;
}

export interface ScreenshotParams {
  format?: 'png' | 'jpeg';
  fullPage?: boolean;
  /** 由 CLI 侧解析后写入的本地路径（协议不负责写文件） */
  path?: string;
}

export interface ExtractParams {
  mode?: 'text' | 'structured';
  /** 返回文本的最大字符数（LLM 上下文裁剪） */
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
  condition?: 'networkidle' | 'load';
}

export interface EvalParams {
  expression: string;
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
  // 滚动 / 视图
  scroll: ScrollParams;
  screenshot: ScreenshotParams;
  // 提取
  extract: ExtractParams;
  'get-page-info': NoopParams;
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
// sessionId / tabId / context 由信封统一携带（见 envelope.ts），data 只放命令特有结果。
// ---------------------------------------------------------------------------

export interface ElementActionResult {
  element: ElementInfo;
}

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
  // 滚动 / 视图
  scroll: { viewport: Viewport };
  screenshot: { data?: string; path?: string };
  // 提取
  extract: { snapshot: PageSnapshot };
  'get-page-info': { url: string; title: string; viewport: Viewport; scrollY: number };
  // 页面内网络
  fetch: {
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    body: string;
  };
  search: { results: SearchResult[] };
  // 标签页
  'list-tabs': { tabs: TabInfo[] };
  'create-tab': { tab: TabInfo };
  'close-tab': Record<string, never>;
  'activate-tab': { tab: TabInfo };
  // 等待
  wait: Record<string, never>;
  // 会话
  ping: { pong: 'pong'; protocolVersion: string; extensionConnected: boolean };
  'get-status': {
    extensionConnected: boolean;
    sessions: SessionInfo[];
    config: Record<string, unknown>;
  };
  // 高级
  eval: { value: unknown };
}

export type ParamsOf<M extends Method> = ParamsMap[M];
export type ResultOf<M extends Method> = ResultMap[M];
