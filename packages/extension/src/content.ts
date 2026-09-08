import { executeDomAction, parseSearchResults } from './dom/actions.js';
import type { ContentCommand, ContentResult } from './shared/messages.js';

/**
 * Content script：监听 background 的命令并执行 DOM 操作。
 * 静态注入 <all_urls>（document_idle）；target tab 与 navId 由 background 在消息中携带。
 */

function handleInternal(method: string, params: Record<string, unknown>): unknown {
  if (method === '_search-parse') {
    const limit = params.limit !== undefined ? Number(params.limit) : 10;
    return { results: parseSearchResults(document).slice(0, limit) };
  }
  throw Object.assign(new Error(`unknown internal method '${method}'`), { code: 'UNKNOWN_METHOD' });
}

chrome.runtime.onMessage.addListener((msg: ContentCommand, _sender, sendResponse) => {
  if (msg?.type !== 'pl:command') return undefined;

  void (async (): Promise<void> => {
    let reply: ContentResult;
    try {
      const result = msg.method.startsWith('_')
        ? handleInternal(msg.method, msg.params)
        : await executeDomAction(msg.method, msg.params, document, msg.tabId, msg.navId);
      reply = { type: 'pl:result', id: msg.id, ok: true, result };
    } catch (err) {
      const e = err as Error & { code?: string };
      reply = {
        type: 'pl:result',
        id: msg.id,
        ok: false,
        error: { code: e.code ?? 'INTERNAL', message: e.message },
      };
    }
    sendResponse(reply);
  })();

  return true; // 异步响应
});
