import { isEvent, isRequest, PROTOCOL_VERSION } from '@parkinglot/protocol/runtime';
import type {
  ContextSnapshot,
  EventMessage,
  ProtocolError,
  Request,
  Response,
  SearchResult,
} from '@parkinglot/protocol';
import type {
  ContentCommand,
  ContentResult,
  PopupRequest,
  PopupResponse,
} from './shared/messages.js';

/**
 * Background service worker：
 * - WebSocket 客户端（hello+token 配对、指数退避重连）
 * - 命令路由：tab 级命令本地处理；页面命令转发 content script；导航类等待 committed 后携带新 navId
 * - navId 追踪（chrome.webNavigation）+ tab-activated 事件上报
 * - popup 消息（配置/状态/HITL 批准队列）
 *
 * 保活说明：WS 连接与心跳由 SW 持有；Chrome 会在 WS 消息到达时唤醒 SW。
 * 若实测 SW 被空闲回收导致断连，迁移到 offscreen document（见 docs/initial-plan.md）。
 */

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let retryDelayMs = 1000;
let connected = false;
let config: { serverUrl: string; token: string } | null = null;
const navIds = new Map<number, number>();
let pendingApprovals: Array<{
  requestId: string;
  method: string;
  summary: string;
  sessionId?: string;
}> = [];
const pendingNavigations = new Map<number, Array<() => void>>();

function code(code: ProtocolError['error']['code'], message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

async function getConfig(): Promise<{ serverUrl: string; token: string }> {
  const stored = await chrome.storage.local.get(['serverUrl', 'token']);
  return { serverUrl: String(stored.serverUrl ?? ''), token: String(stored.token ?? '') };
}

async function saveConfig(serverUrl: string, token: string): Promise<void> {
  await chrome.storage.local.set({ serverUrl, token });
}

// ---------------------------------------------------------------------------
// WebSocket 客户端
// ---------------------------------------------------------------------------

function normalizeWsUrl(serverUrl: string): string {
  return serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
}

function sendWire(obj: unknown): void {
  if (ws !== null && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

async function connect(): Promise<void> {
  config = await getConfig();
  if (!config.serverUrl) return; // 未配置：popup 提示
  const url = normalizeWsUrl(config.serverUrl);
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    retryDelayMs = 1000;
    connected = true;
    sendWire({ type: 'hello', token: config?.token ?? '', extensionVersion: PROTOCOL_VERSION });
  };

  ws.onmessage = (ev) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (isRequest(msg)) {
      void handleCommand(msg);
      return;
    }
    if (isEvent(msg)) {
      handleServerEvent(msg);
    }
  };

  ws.onclose = () => {
    ws = null;
    connected = false;
    scheduleReconnect();
  };
  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
  setTimeout(() => void connect(), delay);
}

// ---------------------------------------------------------------------------
// navId 追踪
// ---------------------------------------------------------------------------

function navIdFor(tabId: number): number {
  return navIds.get(tabId) ?? 0;
}

function bumpNavId(tabId: number): number {
  const next = navIdFor(tabId) + 1;
  navIds.set(tabId, next);
  return next;
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // 仅主框架导航
  const next = bumpNavId(details.tabId);
  const waiters = pendingNavigations.get(details.tabId);
  if (waiters) {
    pendingNavigations.delete(details.tabId);
    for (const w of waiters) w();
  }
  sendWire({
    event: 'page.navigated',
    params: { tabId: details.tabId, url: details.url, navId: next },
  });
});

chrome.tabs.onActivated.addListener((info) => {
  sendWire({ event: 'extension.tab-activated', params: { tabId: info.tabId } });
});

/** 等待某 tab 发生主框架导航（用于导航类命令响应携带新 navId），超时兜底。 */
function waitForNavigation(tabId: number, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    const waiters = pendingNavigations.get(tabId) ?? [];
    waiters.push(resolve);
    pendingNavigations.set(tabId, waiters);
    setTimeout(() => {
      const list = pendingNavigations.get(tabId);
      if (list) {
        const idx = list.indexOf(resolve);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) pendingNavigations.delete(tabId);
      }
      resolve();
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// 命令处理
// ---------------------------------------------------------------------------

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function contextOf(tabId: number): Promise<ContextSnapshot> {
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url ?? '', title: tab.title ?? '', navId: navIdFor(tabId), tabId };
}

/** 扩展侧 wire 结果：动态命令分发，不逐命令强类型（协议层已保证形状）。 */
type WireResult = { sessionId?: string; tabId?: number; context?: ContextSnapshot; data: unknown };

/** sendToContent 使用的请求形状（含内部方法 _search-parse）。 */
interface WireRequest {
  id: string;
  method: string;
  params?: unknown;
}

async function handleCommand(req: Request): Promise<void> {
  try {
    const result = await dispatchCommand(req);
    sendWire({ id: req.id, result } as unknown as Response);
  } catch (err) {
    const e = err as Error & { code?: string };
    sendWire({
      id: req.id,
      error: { code: (e.code ?? 'INTERNAL') as ProtocolError['error']['code'], message: e.message },
    } satisfies ProtocolError);
  }
}

async function dispatchCommand(req: Request): Promise<WireResult> {
  const tabId = req.tabId ?? (await activeTabId());
  if (tabId === undefined) {
    throw code('EXTENSION_NO_TAB', 'no tab available');
  }

  switch (req.method) {
    case 'list-tabs': {
      const tabs = await chrome.tabs.query({});
      return {
        sessionId: req.sessionId,
        tabId,
        data: {
          tabs: tabs.map((t) => ({
            id: t.id ?? -1,
            title: t.title ?? '',
            url: t.url ?? '',
            active: t.active ?? false,
          })),
        },
      };
    }
    case 'create-tab': {
      const url = (req.params as { url: string }).url;
      const tab = await chrome.tabs.create({ url });
      bumpNavId(tab.id ?? -1);
      return {
        sessionId: req.sessionId,
        tabId: tab.id ?? -1,
        context: await contextOf(tab.id ?? -1),
        data: {
          tab: {
            id: tab.id ?? -1,
            title: tab.title ?? '',
            url: tab.url ?? '',
            active: tab.active ?? false,
          },
        },
      };
    }
    case 'close-tab': {
      const target = (req.params as { tabId?: number }).tabId ?? tabId;
      await chrome.tabs.remove(target);
      return { sessionId: req.sessionId, tabId, data: {} };
    }
    case 'activate-tab': {
      const target = (req.params as { tabId: number }).tabId;
      await chrome.tabs.update(target, { active: true });
      const tab = await chrome.tabs.get(target);
      return {
        sessionId: req.sessionId,
        tabId: target,
        context: await contextOf(target),
        data: {
          tab: {
            id: tab.id ?? -1,
            title: tab.title ?? '',
            url: tab.url ?? '',
            active: tab.active ?? false,
          },
        },
      };
    }
    case 'screenshot': {
      const format = (req.params as { format?: string }).format ?? 'png';
      const dataUrl = await chrome.tabs.captureVisibleTab(tabId, {
        format: format as 'png' | 'jpeg',
      });
      const data = dataUrl.split(',')[1] ?? dataUrl;
      return { sessionId: req.sessionId, tabId, context: await contextOf(tabId), data: { data } };
    }
    default:
      break;
  }

  // 导航类：content 执行 → 等待主框架导航 → 响应携带新 navId
  if (
    req.method === 'goto' ||
    req.method === 'back' ||
    req.method === 'forward' ||
    req.method === 'reload'
  ) {
    await sendToContent(req, tabId);
    await waitForNavigation(tabId);
    return { sessionId: req.sessionId, tabId, context: await contextOf(tabId), data: {} };
  }

  // search：导航到搜索引擎 → 等待 → 解析结果页
  if (req.method === 'search') {
    return handleSearch(req, tabId);
  }

  const data = await sendToContent(req, tabId);
  return { sessionId: req.sessionId, tabId, context: await contextOf(tabId), data };
}

async function handleSearch(req: Request, tabId: number): Promise<WireResult> {
  const { query, engine } = req.params as { query: string; engine?: string };
  const url =
    engine === 'google'
      ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
      : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  await chrome.tabs.update(tabId, { url });
  await waitForNavigation(tabId);
  await sleep(600); // 等 content script 在 document_idle 注入
  const { results } = (await sendToContent(
    { id: req.id, method: '_search-parse', params: { limit: 10 } },
    tabId,
  )) as { results: SearchResult[] };
  return { sessionId: req.sessionId, tabId, context: await contextOf(tabId), data: { results } };
}

async function sendToContent(req: WireRequest, tabId: number): Promise<unknown> {
  const msg: ContentCommand = {
    type: 'pl:command',
    id: req.id,
    method: req.method,
    params: (req.params ?? {}) as Record<string, unknown>,
    tabId,
    navId: navIdFor(tabId),
  };
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, msg)) as ContentResult | undefined;
    return unwrapContentReply(reply, req.id);
  } catch (err) {
    const text = String((err as Error).message);
    // 页面尚无 content script（刚安装/更新）→ 动态注入后重试一次
    if (
      text.includes('Receiving end does not exist') ||
      text.includes('Could not establish connection')
    ) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      const reply = (await chrome.tabs.sendMessage(tabId, msg)) as ContentResult | undefined;
      return unwrapContentReply(reply, req.id);
    }
    throw err;
  }
}

function unwrapContentReply(reply: ContentResult | undefined, id: string): unknown {
  if (reply === undefined || reply.type !== 'pl:result') {
    throw code('TARGET_NOT_FOUND', 'content script did not respond (reload the page)');
  }
  if (!reply.ok) {
    throw code(
      (reply.error?.code ?? 'INTERNAL') as ProtocolError['error']['code'],
      reply.error?.message ?? 'unknown content error',
    );
  }
  void id;
  return reply.result;
}

function handleServerEvent(event: EventMessage): void {
  if (event.event === 'approval.requested') {
    const p = event.params as {
      requestId: string;
      method: string;
      summary: string;
      sessionId?: string;
    };
    pendingApprovals.push({
      requestId: p.requestId,
      method: p.method,
      summary: p.summary,
      sessionId: p.sessionId,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// popup 消息
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    msg: PopupRequest | { type: 'pl:content-ready' } | { type: '_tab-id-request' },
    _sender,
    sendResponse,
  ) => {
    switch (msg?.type) {
      case 'config:get': {
        void (async () => {
          const c = await getConfig();
          const res: PopupResponse = {
            type: 'config',
            serverUrl: c.serverUrl,
            token: c.token,
            connected,
          };
          sendResponse(res);
        })();
        return true;
      }
      case 'config:set': {
        void (async () => {
          await saveConfig(msg.config.serverUrl, msg.config.token);
          await connect();
          sendResponse({ type: 'config:ok' } satisfies PopupResponse);
        })();
        return true;
      }
      case 'state:get': {
        void (async () => {
          const c = await getConfig();
          sendResponse({
            type: 'state',
            connected,
            serverUrl: c.serverUrl,
            retryDelayMs,
          } satisfies PopupResponse);
        })();
        return true;
      }
      case 'approvals:list': {
        sendResponse({ type: 'approvals', items: pendingApprovals } satisfies PopupResponse);
        return true;
      }
      case 'approval:respond': {
        pendingApprovals = pendingApprovals.filter((a) => a.requestId !== msg.requestId);
        sendWire({
          event: 'approval.respond',
          params: { requestId: msg.requestId, approved: msg.approved },
        });
        sendResponse({
          type: 'approval:ok',
          requestId: msg.requestId,
          approved: msg.approved,
        } satisfies PopupResponse);
        return true;
      }
      default:
        return undefined;
    }
  },
);

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
void connect();
