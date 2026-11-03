import { isEvent, isRequest, PROTOCOL_VERSION } from '@parklet/protocol/runtime';
import type {
  ContextSnapshot,
  EventMessage,
  ProtocolError,
  Request,
  Response,
  SearchResult,
} from '@parklet/protocol';
import type {
  ContentCommand,
  ContentResult,
  PopupRequest,
  PopupResponse,
} from './shared/messages.js';
import { buildSearchUrl } from './dom/searchUrl.js';
import { computeCropRect, type ElementRectInfo } from './dom/screenshot.js';
import { badgeFor, guidanceFor, statusLabel, type ConnState } from './status.js';

/**
 * Background service worker：
 * - WebSocket 客户端（hello+token 配对、指数退避重连）
 * - 命令路由：tab 级命令本地处理；页面命令转发 content script；导航类等待 committed 后携带新 navId
 * - navId 追踪（chrome.webNavigation）+ tab-activated 事件上报
 * - popup 消息（配置/状态）
 *
 * 保活：WS 连接由 SW 持有；chrome.alarms（0.5min）周期性唤醒 SW，若连接已断开则重连
 * （已在真实 Chrome 验证：空闲 85s/70s 均不掉线）。offscreen document 为更强备选方案。
 */

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let retryDelayMs = 1000;
let connState: ConnState = 'unconfigured';
let lastError: string | undefined;
let config: { serverUrl: string; token: string } | null = null;
const navIds = new Map<number, number>();
const pendingNavigations = new Map<number, Array<() => void>>();

function code(
  code: ProtocolError['error']['code'],
  message: string,
  data?: Record<string, unknown>,
): Error & { code: string; data?: Record<string, unknown> } {
  return Object.assign(new Error(message), { code, ...(data !== undefined ? { data } : {}) });
}

// ---------------------------------------------------------------------------
// 连接状态（badge + popup 引导；持久化到 storage.session 以跨 SW 重启）
// ---------------------------------------------------------------------------

function updateBadge(): void {
  const badge = badgeFor(connState);
  if (badge === null) return; // connecting：保持上一个 badge
  void chrome.action.setBadgeText({ text: badge.text });
  void chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

function applyState(next: ConnState, error?: string): void {
  connState = next;
  lastError = error;
  updateBadge();
  void chrome.storage.session.set({ connState: next, lastError: error ?? null }).catch(() => {});
}

function statusPayload(): {
  state: ConnState;
  label: string;
  guidance: string;
  serverUrl: string;
  lastError?: string;
  retryDelayMs: number;
} {
  const serverUrl = config?.serverUrl ?? '';
  return {
    state: connState,
    label: statusLabel(connState),
    guidance: guidanceFor(connState, { serverUrl, lastError }),
    serverUrl,
    lastError,
    retryDelayMs,
  };
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

// 防止并发/重复建连：connect() 在 await getConfig 前后可能被 alarm/心跳/重连定时器
// 同时触发，若不加锁会创建多条 WS，server 端“新连接替换旧连接”会把在途命令打断。
let connecting = false;

async function connect(): Promise<void> {
  if (connecting) return;
  if (ws !== null && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }
  connecting = true;
  try {
    config = await getConfig();
    if (config.serverUrl.length === 0 || config.token.length === 0) {
      applyState('unconfigured');
      return;
    }
    const url = normalizeWsUrl(config.serverUrl);
    if (connState !== 'connected') applyState('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      applyState('disconnected', String(err));
      scheduleReconnect();
      return;
    }
    ws = socket;

    // 每个 handler 都校验 ws === socket：被替换的旧 socket 的事件不得影响当前连接
    socket.onopen = () => {
      if (ws !== socket) return;
      retryDelayMs = 1000;
      sendWire({ type: 'hello', token: config?.token ?? '', extensionVersion: PROTOCOL_VERSION });
      // “已连接”以 server 的 extension.connected 事件为准（token 校验通过之后）
    };

    socket.onmessage = (ev) => {
      if (ws !== socket) return;
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
      if (isEvent(msg)) handleServerEvent(msg);
    };

    socket.onclose = (event) => {
      if (ws !== socket) return; // 旧连接被替换，忽略其 close
      ws = null;
      if (event.code === 4401 || event.code === 4400) {
        // 配置无效（token 错 / hello 非法）：不自动重连，等用户修正配置
        applyState('auth_failed', `handshake rejected (${event.code})`);
        return;
      }
      applyState('disconnected', event.reason || `closed (${event.code})`);
      scheduleReconnect();
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    };
  } finally {
    connecting = false;
  }
}

function handleServerEvent(event: EventMessage): void {
  if (event.event === 'extension.connected') applyState('connected');
}

function scheduleReconnect(): void {
  if (connState === 'auth_failed') return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
  setTimeout(() => void connect(), delay);
}

/** 配置变更/手动重试：主动断开当前连接并用最新配置重连。 */
function forceReconnect(): void {
  const socket = ws;
  ws = null;
  if (socket !== null) {
    // 旧 socket 的 onclose 因 ws !== socket 而提前返回，不会触发 scheduleReconnect
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }
  retryDelayMs = 1000;
  applyState('connecting');
  void connect();
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

// tab 生命周期事件：server 缓存并计入未读（供 `plt events`）
chrome.tabs.onCreated.addListener((tab) => {
  sendWire({
    event: 'tab.created',
    params: {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url ?? '',
      title: tab.title ?? '',
    },
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  sendWire({
    event: 'tab.removed',
    params: { tabId, windowId: removeInfo.windowId, isWindowClosing: removeInfo.isWindowClosing },
  });
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
type WireResult = { tabId?: number; context?: ContextSnapshot; data: unknown };

/** sendToContent 使用的请求形状（含内部方法 _search-parse）。 */
interface WireRequest {
  id: string;
  method: string;
  params?: unknown;
}

/** chrome.tabs 的"tab 已不存在"错误文案（不同路径措辞略有差异），统一映射为 TAB_CLOSED。 */
const TAB_GONE_RE = /no tab with id|invalid tab id|no tab with id:|tab was closed/i;

function normalizeError(err: unknown): {
  code: ProtocolError['error']['code'];
  message: string;
  data?: Record<string, unknown>;
} {
  const e = err as Error & { code?: string; data?: Record<string, unknown> };
  const message = e?.message ?? String(err);
  if (typeof e?.code === 'string') {
    return {
      code: e.code as ProtocolError['error']['code'],
      message,
      ...(e.data !== undefined ? { data: e.data } : {}),
    };
  }
  if (TAB_GONE_RE.test(message)) {
    return { code: 'TAB_CLOSED', message };
  }
  return { code: 'INTERNAL', message };
}

async function handleCommand(req: Request): Promise<void> {
  try {
    const result = await dispatchCommand(req);
    sendWire({ id: req.id, result } as unknown as Response);
  } catch (err) {
    const { code: errCode, message, data } = normalizeError(err);
    sendWire({
      id: req.id,
      error: { code: errCode, message, ...(data !== undefined ? { data } : {}) },
    } satisfies ProtocolError);
  }
}

async function dispatchCommand(req: Request): Promise<WireResult> {
  const tabId = req.tabId ?? (await activeTabId());
  if (tabId === undefined) {
    throw code('EXTENSION_NO_TAB', 'no tab available');
  }

  // scroll / scroll-to 可选先激活目标 tab，避免后台标签页被节流。
  if (
    (req.method === 'scroll' || req.method === 'scroll-to') &&
    (req.params as { focus?: boolean } | undefined)?.focus === true
  ) {
    await chrome.tabs.update(tabId, { active: true });
    await sleep(75);
  }

  switch (req.method) {
    case 'list-tabs': {
      const tabs = await chrome.tabs.query({});
      return {
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
      return { tabId, data: {} };
    }
    case 'activate-tab': {
      const target = (req.params as { tabId: number }).tabId;
      await chrome.tabs.update(target, { active: true });
      const tab = await chrome.tabs.get(target);
      return {
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
      const p = req.params as { format?: string; selector?: string; restoreFocus?: boolean };
      const format = p.format ?? 'png';
      // captureVisibleTab 接收 windowId（可选）；先从 tabId 解析出 windowId
      const tab = await chrome.tabs.get(tabId);
      let previousActive: number | undefined;
      if (p.selector !== undefined && tab.active !== true) {
        const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        previousActive = active?.id;
        await chrome.tabs.update(tabId, { active: true });
        await sleep(100);
      }
      const restore = async (): Promise<void> => {
        if (p.restoreFocus === true && previousActive !== undefined) {
          await chrome.tabs.update(previousActive, { active: true }).catch(() => {});
        }
      };
      try {
        if (p.selector !== undefined) {
          const rectInfo = (await sendToContent(
            { id: req.id, method: '_element-rect', params: { selector: p.selector } },
            tabId,
          )) as ElementRectInfo;
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: format as 'png' | 'jpeg',
          });
          const data = await cropScreenshot(dataUrl, rectInfo, format);
          return { tabId, context: await contextOf(tabId), data: { data } };
        }
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: format as 'png' | 'jpeg',
        });
        const data = dataUrl.split(',')[1] ?? dataUrl;
        return { tabId, context: await contextOf(tabId), data: { data } };
      } finally {
        await restore();
      }
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
    return { tabId, context: await contextOf(tabId), data: {} };
  }

  // search：导航到搜索引擎 → 等待 → 解析结果页
  if (req.method === 'search') {
    return handleSearch(req, tabId);
  }

  // eval：必须在 MAIN world 执行（隔离世界的 new Function 被扩展 CSP 阻断）
  if (req.method === 'eval') {
    return handleEval(req, tabId);
  }

  const data = await sendToContent(req, tabId);
  return { tabId, context: await contextOf(tabId), data };
}

/** eval 的注入结果（由 MAIN world 函数返回，需可 JSON 序列化回 SW）。 */
interface EvalOutcome {
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}

/**
 * 在页面 **MAIN world** 执行 eval。注入函数必须自包含（Chrome 序列化函数体，无法引用外部导入）。
 * 隔离世界的 `new Function` 被 MV3 扩展 CSP 恒定为不允许 `unsafe-eval` 阻断（已用真实 Chromium 验证）；
 * MAIN world 不受扩展 CSP 约束、但**受页面 CSP 约束**：严格 CSP 站点会返回错误。
 */
async function handleEval(req: Request, tabId: number): Promise<WireResult> {
  const script = String((req.params as { script?: unknown }).script ?? '');
  let outcome: EvalOutcome | undefined;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: injectedEval,
      args: [script],
    });
    outcome = results[0]?.result as EvalOutcome | undefined;
  } catch (err) {
    throw code('INTERNAL', `eval injection failed (page CSP?): ${(err as Error).message}`);
  }
  if (outcome === undefined || outcome.ok !== true) {
    throw code(
      (outcome?.code ?? 'INTERNAL') as ProtocolError['error']['code'],
      outcome?.message ?? 'eval failed',
    );
  }
  const data = outcome.value === undefined ? {} : { value: outcome.value };
  return { tabId, context: await contextOf(tabId), data };
}

/** 自包含注入函数（MAIN world）。用 `new Function` 编译用户脚本，必须含 `return`。 */
function injectedEval(script: string): Promise<EvalOutcome> {
  return (async (): Promise<EvalOutcome> => {
    let run: () => Promise<unknown>;
    try {
      run = new Function(
        `"use strict"; return (async () => {\n${script}\n})();`,
      ) as () => Promise<unknown>;
    } catch (err) {
      const isSyntax = err instanceof SyntaxError;
      return {
        ok: false,
        code: isSyntax ? 'INVALID_PARAMS' : 'INTERNAL',
        message: isSyntax
          ? `eval script is not valid JavaScript: ${String(err)}`
          : `eval blocked: ${String(err)}`,
      };
    }
    try {
      const value = await run();
      if (value === undefined) return { ok: true };
      try {
        // 以 JSON 往返为唯一可序列化判据
        return { ok: true, value: JSON.parse(JSON.stringify(value)) as unknown };
      } catch (err) {
        return { ok: false, code: 'NOT_SERIALIZABLE', message: String(err) };
      }
    } catch (err) {
      return { ok: false, code: 'INTERNAL', message: (err as Error)?.message ?? String(err) };
    }
  })();
}

async function handleSearch(req: Request, tabId: number): Promise<WireResult> {
  const { query, engine, page } = req.params as { query: string; engine?: string; page?: number };
  const url = buildSearchUrl(query, engine, page);
  await chrome.tabs.update(tabId, { url });
  await waitForNavigation(tabId);
  await sleep(600); // 等 content script 在 document_idle 注入
  const { results } = (await sendToContent(
    { id: req.id, method: '_search-parse', params: { limit: 25 } },
    tabId,
  )) as { results: SearchResult[] };
  return {
    tabId,
    context: await contextOf(tabId),
    data: {
      results,
      pagination: { query, engine: engine ?? 'google', page: page ?? 1 },
    },
  };
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
      reply.error?.data,
    );
  }
  void id;
  return reply.result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** captureVisibleTab 的 dataUrl 按元素 rect 裁剪（OffscreenCanvas，SW 可用）。 */
async function cropScreenshot(
  dataUrl: string,
  rectInfo: ElementRectInfo,
  format: string,
): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const crop = computeCropRect(rectInfo.rect, rectInfo.devicePixelRatio, rectInfo.viewport, {
    width: bitmap.width,
    height: bitmap.height,
  });
  if (crop.width === 0 || crop.height === 0) {
    bitmap.close();
    throw code('TARGET_NOT_FOUND', 'element is outside the visible viewport');
  }
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    throw code('INTERNAL', 'cannot create 2d canvas context');
  }
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({
    type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
  });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

// ---------------------------------------------------------------------------
// SW 保活
//
// MV3 service worker 在 ~30s 无事件后会被 Chrome 回收，WebSocket 随进程销毁。
// 用 chrome.alarms 周期性唤醒（最小周期 0.5min，Chrome 120+），被唤醒时若连接
// 已断开立即重连；SW 每次唤醒都会重跑顶层代码，此处只负责提供唤醒事件。
// ---------------------------------------------------------------------------

// 保活块整体防御：任一 API 不可用都不应中断顶层脚本（曾因缺 alarms 权限导致
// chrome.alarms.create 抛错、后续监听器全部未注册、popup/WS 全失效）。
try {
  chrome.alarms.create('parklet-keepalive', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'parklet-keepalive') return;
    if (ws === null && connState !== 'auth_failed') void connect();
  });
} catch (err) {
  console.error('[parklet] alarms unavailable:', err);
}

// 应用层心跳：Chrome 116+ 中 WebSocket 收发消息会重置 SW 空闲计时器，
// 因此只要 WS 在线，每 20s 发一条即可避免 SW 被回收（alarms 仍作兜底）。
// 注意：protocol-level ping/pong 由浏览器网络栈处理，不计入 SW 活动。
const HEARTBEAT_INTERVAL_MS = 20_000;
try {
  setInterval(() => {
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      sendWire({ type: 'heartbeat', ts: Date.now() });
    } else if (ws === null && connState !== 'auth_failed') {
      void connect();
    }
  }, HEARTBEAT_INTERVAL_MS);
} catch (err) {
  console.error('[parklet] heartbeat unavailable:', err);
}

// ---------------------------------------------------------------------------
// 自动配对：chrome.storage.local 的 serverUrl/token 一写入即触发连接。
// popup 的 Save & Connect 与自动化（E2E/Playwright 经 SW 注入配置）共用此入口。
// ---------------------------------------------------------------------------
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.serverUrl !== undefined || changes.token !== undefined) {
      forceReconnect();
    }
  });
} catch (err) {
  console.error('[parklet] storage hook unavailable:', err);
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
            connected: connState === 'connected',
          };
          sendResponse(res);
        })();
        return true;
      }
      case 'config:set': {
        void (async () => {
          await saveConfig(msg.config.serverUrl, msg.config.token);
          forceReconnect();
          sendResponse({ type: 'config:ok' } satisfies PopupResponse);
        })();
        return true;
      }
      case 'state:get': {
        void (async () => {
          const payload = statusPayload();
          sendResponse({
            type: 'state',
            ...payload,
            connected: payload.state === 'connected',
          } satisfies PopupResponse);
        })();
        return true;
      }
      case 'state:retry': {
        void (async () => {
          forceReconnect();
          sendResponse({ type: 'state:ok' } satisfies PopupResponse);
        })();
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

/** SW 重启后恢复上次连接状态并重设 badge（内存状态会丢失）。 */
async function restoreState(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(['connState', 'lastError']);
    if (typeof stored.connState === 'string') connState = stored.connState as ConnState;
    lastError = typeof stored.lastError === 'string' ? stored.lastError : undefined;
  } catch {
    /* storage.session 不可用则保持默认 */
  }
  updateBadge();
}

chrome.runtime.onStartup.addListener(() => {
  void restoreState().then(() => connect());
});
chrome.runtime.onInstalled.addListener(() => {
  void restoreState().then(() => connect());
});
void restoreState().then(() => connect());
