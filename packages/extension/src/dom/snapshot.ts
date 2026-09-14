// 核心包 `defuddle` 不含 markdown 转换器（markdown:true 会被静默忽略），
// `defuddle/full` 才带 turndown 转换（代价：content.js 体积增加）。
import DefuddleModule from 'defuddle/full';
import type { DefuddleOptions } from 'defuddle';
import type {
  ContextSnapshot,
  DomNode,
  ExtractResult,
  PageSnapshot,
  Viewport,
} from '@parkinglot/protocol';

/** defuddle 以 CJS/UMD 发布（module.exports = 类），NodeNext 下默认导入类型退化为命名空间，这里显式收窄。 */
interface ArticleParseResult {
  content?: string;
  title?: string;
  author?: string;
  site?: string;
  description?: string;
  domain?: string;
  language?: string;
  wordCount?: number;
}
type DefuddleConstructor = new (
  doc: Document,
  options?: DefuddleOptions,
) => { parse(): ArticleParseResult };
const Defuddle = DefuddleModule as unknown as DefuddleConstructor;

/** 页面快照 / 提取（纯 DOM 逻辑，happy-dom 可测）。 */

/** 结构化提取的总节点预算（固定常量，不进 wire 参数）：超限按 BFS 截断并置 truncated。 */
export const MAX_STRUCTURED_NODES = 500;
/** 单个 DomNode 直系文本的字符上限（防止超长文本撑爆消息）。 */
const MAX_NODE_TEXT = 500;

function skipElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'svg'
  );
}

function isVisible(el: Element): boolean {
  if (el.hasAttribute('hidden')) return false;
  const style = (el as HTMLElement).style;
  if (style !== undefined && style !== null) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
  }
  return true;
}

function scopeOf(root: Element | Document): Element | null {
  if (root.nodeType === 9) return (root as Document).body;
  return root as Element;
}

/** 提取可见文本（innerText 近似，回退到 TreeWalker 并排除 script/style）。 */
export function extractVisibleText(root: Element | Document | null, maxChars?: number): string {
  const scope = root === null ? null : scopeOf(root);
  if (scope === null) return '';
  let text = '';
  const inner = (scope as HTMLElement).innerText;
  if (typeof inner === 'string' && inner.length > 0) {
    text = inner.trim();
  } else {
    const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let node = walker.nextNode();
    while (node !== null) {
      const parent = node.parentElement;
      if (parent !== null && !skipElement(parent)) {
        parts.push(node.textContent ?? '');
      }
      node = walker.nextNode();
    }
    text = parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  if (maxChars !== undefined && maxChars > 0 && text.length > maxChars) {
    return `${text.slice(0, maxChars)}…`;
  }
  return text;
}

export function getViewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function getScrollY(): number {
  return window.scrollY;
}

export function buildContextSnapshot(doc: Document, tabId: number, navId: number): ContextSnapshot {
  return {
    url: doc.location.href,
    title: doc.title,
    navId,
    tabId,
  };
}

export function buildPageSnapshot(
  doc: Document,
  tabId: number,
  navId: number,
  maxChars?: number,
): PageSnapshot {
  return {
    context: buildContextSnapshot(doc, tabId, navId),
    visibleText: extractVisibleText(doc, maxChars),
    viewport: getViewport(),
    scrollY: getScrollY(),
  };
}

// ---------------------------------------------------------------------------
// extract：text / structured / article
// ---------------------------------------------------------------------------

export interface ExtractOptions {
  mode?: 'text' | 'structured';
  article?: boolean;
  selector?: string;
  offset?: number;
  limit?: number;
  depth?: number;
  visibleOnly?: boolean;
  maxChars?: number;
}

/**
 * 「第一层列表」定义：selector 匹配多个时取匹配元素；只匹配一个时取其子元素；
 * 无 selector 时以 body 为单 root（取其子元素）。offset/limit/visibleOnly 都作用于该列表。
 */
export function firstLayerElements(matched: Element[]): Element[] {
  if (matched.length === 1) {
    const only = matched[0];
    return only === undefined ? [] : Array.from(only.children);
  }
  return matched;
}

function sliceList(list: Element[], offset?: number, limit?: number): Element[] {
  const start = Math.max(0, offset ?? 0);
  const end = limit !== undefined ? start + Math.max(0, limit) : undefined;
  return list.slice(start, end);
}

function directText(el: Element): string | undefined {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? '';
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return undefined;
  return normalized.length > MAX_NODE_TEXT ? `${normalized.slice(0, MAX_NODE_TEXT)}…` : normalized;
}

function makeDomNode(el: Element): DomNode {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
  const node: DomNode = { tag: el.tagName.toLowerCase(), attrs, children: [] };
  const text = directText(el);
  if (text !== undefined) node.text = text;
  return node;
}

/**
 * 由第一层列表构建 DOM 树。按广度优先（前序 per-level）分配 maxNodes 预算，
 * 超限时优先保留高层的整体结构并置 truncated。
 */
export function buildDomTree(
  roots: Element[],
  depth: number,
  maxNodes = MAX_STRUCTURED_NODES,
): { nodes: DomNode[]; truncated: boolean } {
  const nodes: DomNode[] = [];
  const queue: Array<{ el: Element; node: DomNode; level: number }> = [];
  let count = 0;
  let truncated = false;

  for (const el of roots) {
    if (skipElement(el)) continue;
    if (count >= maxNodes) {
      truncated = true;
      break;
    }
    const node = makeDomNode(el);
    count += 1;
    nodes.push(node);
    queue.push({ el, node, level: 0 });
  }

  let budgetHit = false;
  while (queue.length > 0 && !budgetHit) {
    const entry = queue.shift();
    if (entry === undefined) break;
    const { el, node, level } = entry;
    if (level >= depth) continue;
    for (const child of Array.from(el.children)) {
      if (skipElement(child)) continue;
      if (count >= maxNodes) {
        truncated = true;
        budgetHit = true;
        break;
      }
      const childNode = makeDomNode(child);
      count += 1;
      node.children.push(childNode);
      queue.push({ el: child, node: childNode, level: level + 1 });
    }
  }

  return { nodes, truncated };
}

function extractArticle(doc: Document, selector?: string): ExtractResult {
  const options: { markdown: boolean; contentSelector?: string; url?: string } = { markdown: true };
  if (selector !== undefined) options.contentSelector = selector;
  if (doc.location?.href) options.url = doc.location.href;
  const res = new Defuddle(doc, options).parse();
  const article: ExtractResult = {
    mode: 'article',
    content: res.content ?? '',
    ...(res.title ? { title: res.title } : {}),
    ...(res.author ? { author: res.author } : {}),
    ...(res.site ? { site: res.site } : {}),
    ...(res.description ? { description: res.description } : {}),
    ...(res.domain ? { domain: res.domain } : {}),
    ...(res.language ? { language: res.language } : {}),
    ...(doc.location?.href ? { url: doc.location.href } : {}),
    ...(res.wordCount ? { wordCount: res.wordCount } : {}),
  };
  return article;
}

/** extract 命令入口：按 params 分发 text / structured / article。 */
export function extractPage(
  doc: Document,
  params: ExtractOptions,
  tabId: number,
  navId: number,
): ExtractResult {
  if (params.article === true) {
    return extractArticle(doc, params.selector);
  }

  const mode = params.mode ?? 'text';
  const matched =
    params.selector !== undefined ? Array.from(doc.querySelectorAll(params.selector)) : [doc.body];
  const layer = firstLayerElements(matched);
  // 先按 visibleOnly 过滤，再计算 total（分页前可用总数），最后 offset/limit 切片
  const visible = params.visibleOnly === true ? layer.filter(isVisible) : layer;
  const total = visible.length;
  const sliced = sliceList(visible, params.offset, params.limit);
  const pagination = {
    total,
    ...(params.offset !== undefined ? { offset: params.offset } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  };

  if (mode === 'structured') {
    const { nodes, truncated } = buildDomTree(sliced, params.depth ?? 3);
    return {
      mode: 'structured',
      nodes,
      ...pagination,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  if (params.selector !== undefined) {
    const texts = sliced.map((el) => extractVisibleText(el, params.maxChars));
    return { mode: 'text', texts, ...pagination };
  }

  return { mode: 'text', snapshot: buildPageSnapshot(doc, tabId, navId, params.maxChars) };
}
