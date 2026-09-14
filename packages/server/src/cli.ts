#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type Method,
  type ProtocolError,
  type Response,
} from '@parkinglot/protocol';
import { startServer } from './index.js';

interface GlobalOpts {
  server: string;
  json: boolean;
  timeout: string;
  session?: string;
  /** screenshot 的 --path（写文件目标） */
  path?: string;
  /** extract structured 的 --prettify（仅展示，不进 wire） */
  prettify?: boolean;
}

interface CachedEvent {
  event: string;
  params: Record<string, unknown>;
  ts: string;
}

// ---------------------------------------------------------------------------
// HTTP client（CLI 通过 /api/* 与常驻 server 通信）
// ---------------------------------------------------------------------------

async function callCommand(
  method: string,
  params: Record<string, unknown>,
  opts: GlobalOpts,
): Promise<Response | ProtocolError> {
  const base = opts.server.replace(/\/+$/, '');
  const body = { method, params, sessionId: opts.session };
  let httpRes: Response;
  try {
    const res = await fetch(`${base}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(opts.timeout) + 10_000),
    });
    httpRes = (await res.json()) as Response;
  } catch (err) {
    return {
      id: '',
      error: {
        code: 'EXTENSION_OFFLINE',
        message: `cannot reach server at ${base}: ${(err as Error).message}. Start it with: pnpm --filter @parkinglot/server start`,
      },
    } satisfies ProtocolError;
  }
  return httpRes;
}

async function callSession(
  action: 'new' | 'use' | 'close',
  opts: GlobalOpts,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | ProtocolError> {
  const base = opts.server.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return { error: `cannot reach server at ${base}: ${(err as Error).message}` };
  }
}

async function fetchStatus(opts: GlobalOpts): Promise<Record<string, unknown> | ProtocolError> {
  const base = opts.server.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(10_000) });
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return { error: `cannot reach server at ${base}: ${(err as Error).message}` };
  }
}

async function fetchLedger(
  opts: GlobalOpts,
  tail: number,
): Promise<{ entries: Array<Record<string, unknown>> } | { error: string }> {
  const base = opts.server.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/ledger?tail=${tail}`, {
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as { entries: Array<Record<string, unknown>> };
  } catch (err) {
    return { error: `cannot reach server at ${base}: ${(err as Error).message}` };
  }
}

async function fetchEvents(
  opts: GlobalOpts,
): Promise<{ events: CachedEvent[]; unreadCount: number } | { error: string }> {
  const base = opts.server.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/events`, { signal: AbortSignal.timeout(10_000) });
    return (await res.json()) as { events: CachedEvent[]; unreadCount: number };
  } catch (err) {
    return { error: `cannot reach server at ${base}: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// 输出与退出码
// ---------------------------------------------------------------------------

function exitCodeFor(code: ErrorCode | undefined): number {
  switch (code) {
    case 'INVALID_REQUEST':
    case 'INVALID_PARAMS':
    case 'UNKNOWN_METHOD':
      return 2;
    case 'SESSION_NOT_FOUND':
    case 'SESSION_TAB_CLOSED':
    case 'TARGET_NOT_FOUND':
    case 'TARGET_AMBIGUOUS':
    case 'TAB_NOT_ACTIVE':
    case 'URL_INVALID':
    case 'HOST_NOT_ALLOWED':
    case 'EVAL_DISABLED':
      return 3;
    case 'EXTENSION_OFFLINE':
    case 'EXTENSION_NO_TAB':
      return 4;
    case 'TIMEOUT':
      return 6;
    default:
      return 1;
  }
}

function formatContext(result: Response['result']): string {
  const { context, sessionId } = result;
  if (!context) return '';
  return `📍 ${context.url} — ${context.title} (navId=${context.navId}, tab=${context.tabId}${sessionId ? `, session=${sessionId}` : ''})`;
}

function printResult(method: string, result: Response['result'], opts: GlobalOpts): void {
  if (opts.json) {
    console.log(
      JSON.stringify({
        sessionId: result.sessionId,
        tabId: result.tabId,
        context: result.context,
        data: result.data,
      }),
    );
    return;
  }
  const ctx = formatContext(result);
  const data = result.data as Record<string, unknown> | undefined;
  switch (method) {
    case 'ping': {
      const d = data as { pong?: string; protocolVersion?: string; extensionConnected?: boolean };
      console.log(
        `pong v${d.protocolVersion ?? '?'} — extension ${d.extensionConnected ? 'connected ✅' : 'offline ❌'}`,
      );
      break;
    }
    case 'get-status': {
      const d = data as {
        extensionConnected?: boolean;
        sessions?: Array<{ id: string; tabId?: number; lastUsedAt: string }>;
        config?: Record<string, unknown>;
      };
      console.log(`extension: ${d.extensionConnected ? 'connected ✅' : 'offline ❌'}`);
      console.log(`sessions: ${(d.sessions ?? []).length}`);
      for (const s of d.sessions ?? []) {
        console.log(`  ${s.id}  tab=${s.tabId ?? '-'}  last=${s.lastUsedAt}`);
      }
      break;
    }
    case 'extract': {
      const d = data as {
        mode?: 'text' | 'structured' | 'article';
        snapshot?: { visibleText?: string; viewport?: { width: number; height: number } };
        texts?: string[];
        nodes?: unknown;
        total?: number;
        offset?: number;
        limit?: number;
        truncated?: boolean;
        content?: string;
        title?: string;
        author?: string;
        site?: string;
        description?: string;
        domain?: string;
        language?: string;
        url?: string;
        wordCount?: number;
      };
      if (ctx) console.log(ctx);
      const shown = Array.isArray(d.texts)
        ? d.texts.length
        : Array.isArray(d.nodes)
          ? d.nodes.length
          : 0;
      const range =
        d.total !== undefined
          ? `[showing ${shown} of ${d.total}${d.offset !== undefined ? `, offset=${d.offset}` : ''}${d.limit !== undefined ? `, limit=${d.limit}` : ''}]`
          : undefined;
      if (d.mode === 'article') {
        const frontmatter: Array<[string, unknown]> = [
          ['title', d.title],
          ['author', d.author],
          ['site', d.site],
          ['domain', d.domain],
          ['url', d.url],
          ['language', d.language],
          ['wordCount', d.wordCount],
          ['description', d.description],
        ];
        const fields = frontmatter.filter(([, v]) => v !== undefined && v !== '');
        if (fields.length > 0) {
          console.log('---');
          for (const [key, value] of fields) console.log(`${key}: ${String(value)}`);
          console.log('---\n');
        }
        console.log(d.content ?? '(no content)');
      } else if (Array.isArray(d.texts)) {
        d.texts.forEach((t, i) => console.log(`[${i + 1}] ${t}`));
        if (range) console.log(range);
      } else if (d.nodes !== undefined) {
        console.log(opts.prettify ? JSON.stringify(d.nodes, null, 2) : JSON.stringify(d.nodes));
        if (d.truncated === true) console.log('(truncated at node budget)');
        if (range) console.log(range);
      } else {
        console.log(d.snapshot?.visibleText ?? '(no text)');
        if (d.snapshot?.viewport)
          console.log(`\n[viewport ${d.snapshot.viewport.width}x${d.snapshot.viewport.height}]`);
      }
      break;
    }
    case 'get-page-info': {
      const d = data as {
        url?: string;
        title?: string;
        viewport?: { width: number; height: number };
        scrollY?: number;
      };
      console.log(`url: ${d.url}`);
      console.log(`title: ${d.title}`);
      console.log(`viewport: ${d.viewport?.width}x${d.viewport?.height}  scrollY: ${d.scrollY}`);
      break;
    }
    case 'click':
    case 'click-text':
    case 'fill':
    case 'type':
    case 'press':
    case 'hover':
    case 'select': {
      const d = data as {
        element?: { tag: string; text?: string; box?: { x: number; y: number } };
      };
      const el = d.element;
      const box = el?.box ? ` @(${el.box.x},${el.box.y})` : '';
      console.log(`⚡ <${el?.tag ?? '?'}> ${el?.text ?? ''}${box}`);
      break;
    }
    case 'scroll': {
      const d = data as { viewport?: { width: number; height: number } };
      console.log(`scrolled — viewport ${d.viewport?.width}x${d.viewport?.height}`);
      break;
    }
    case 'screenshot': {
      const d = data as { data?: string; path?: string };
      const target = d.path ?? opts.path;
      if (typeof target === 'string' && target.length > 0 && typeof d.data === 'string') {
        writeFileSync(target, Buffer.from(d.data, 'base64'));
        console.log(`📸 saved to ${target}`);
      } else {
        console.log(`📸 ${((d.data?.length ?? 0) / 1024).toFixed(1)} KB base64`);
      }
      break;
    }
    case 'list-tabs': {
      const d = data as {
        tabs?: Array<{ id: number; title: string; url: string; active: boolean }>;
      };
      for (const t of d.tabs ?? []) {
        console.log(`${t.id}${t.active ? '*' : ' '}  ${t.title}  ${t.url}`);
      }
      break;
    }
    case 'search': {
      const d = data as {
        results?: Array<{ title?: string; url?: string; snippet?: string }>;
        pagination?: { query?: string; engine?: string; page?: number };
      };
      const pg = d.pagination;
      if (pg) {
        const next = (pg.page ?? 1) + 1;
        console.log(
          `[${pg.engine ?? 'duckduckgo'} · page ${pg.page ?? 1} of "${pg.query ?? ''}" — 用 --page ${next} 取下一页]`,
        );
      }
      (d.results ?? []).forEach((r, i) => {
        console.log(`${i + 1}. ${r.title ?? ''}\n   ${r.url ?? ''}\n   ${r.snippet ?? ''}`);
      });
      break;
    }
    case 'fetch': {
      const d = data as { status?: number; statusText?: string; body?: string };
      console.log(`HTTP ${d.status ?? '?'} ${d.statusText ?? ''}`);
      console.log(String(d.body ?? '').slice(0, 2000));
      break;
    }
    case 'goto':
    case 'back':
    case 'forward':
    case 'reload':
    case 'activate-tab':
    case 'create-tab':
    case 'wait':
      if (ctx) console.log(ctx);
      break;
    default:
      if (ctx) console.log(ctx);
      if (data !== undefined) console.log(JSON.stringify(data));
  }
}

function printError(error: ProtocolError['error'], opts: GlobalOpts): void {
  const msg = `✖ [${error.code}] ${error.message}`;
  if (opts.json) console.log(JSON.stringify({ error }));
  else console.error(msg);
}

// ---------------------------------------------------------------------------
// commander 注册
// ---------------------------------------------------------------------------

function register(
  program: Command,
  name: string,
  method: Method,
  description: string,
  buildParams: (opts: Record<string, unknown>, args: string[]) => Record<string, unknown>,
  options?: (cmd: Command) => void,
): void {
  const c = program.command(name).description(description);
  options?.(c);
  c.action((...rawArgs: unknown[]) => {
    const commandObj = rawArgs.pop() as Command;
    const opts = commandObj.optsWithGlobals() as Record<string, unknown>;
    const args = rawArgs as string[];
    void run(method, buildParams(opts, args), opts);
  });
}

async function run(
  method: Method,
  params: Record<string, unknown>,
  opts: Record<string, unknown>,
): Promise<void> {
  const g: GlobalOpts = {
    server: String(opts.server ?? 'http://127.0.0.1:8787'),
    json: Boolean(opts.json),
    timeout: String(opts.timeout ?? '30000'),
    session: typeof opts.session === 'string' ? opts.session : undefined,
    path: typeof opts.path === 'string' ? opts.path : undefined,
    prettify: Boolean(opts.prettify),
  };
  const res = await callCommand(method, params, g);
  if ('error' in res) {
    printError(res.error, g);
    process.exitCode = exitCodeFor(res.error.code);
  } else {
    printResult(method, res.result, g);
    const unread = (res.result as { unreadCount?: number }).unreadCount ?? 0;
    if (unread > 0 && !g.json) console.log(`\n🔔 ${unread} new events, run \`plt events\``);
    process.exitCode = 0;
  }
}

export function buildProgram(): Command {
  const program = new Command()
    .name('plt')
    .description('ParkingLot CLI — control the browser through parkinglot-server')
    .version(PROTOCOL_VERSION)
    .option('--server <url>', 'server base URL', 'http://127.0.0.1:8787')
    .option('--json', 'output structured JSON (envelope)')
    .option('--timeout <ms>', 'command timeout in milliseconds', '30000')
    .option('--session <id>', 'session id to target (defaults to the server default session)');

  // 会话 / 状态
  register(
    program,
    'status',
    'get-status',
    'show server, extension and session status',
    () => ({}),
  );
  register(program, 'ping', 'ping', 'connectivity check', () => ({}));

  // 导航
  register(
    program,
    'goto',
    'goto',
    'navigate to a URL',
    (opts, args) => ({ url: args[0], waitUntil: opts.waitUntil }),
    (c) =>
      c
        .argument('<url>', 'http(s) URL')
        .option('--wait-until <phase>', 'load|domcontentloaded', 'load'),
  );
  register(program, 'back', 'back', 'go back in history', () => ({}));
  register(program, 'forward', 'forward', 'go forward in history', () => ({}));
  register(program, 'reload', 'reload', 'reload the current page', () => ({}));

  // 交互
  register(
    program,
    'click',
    'click',
    'click an element by CSS selector',
    (_opts, args) => ({ selector: args[0] }),
    (c) => c.argument('<selector>'),
  );
  register(
    program,
    'click-text',
    'click-text',
    'click an element by visible text',
    (_opts, args) => ({ text: args[0] }),
    (c) => c.argument('<text>'),
  );
  register(
    program,
    'fill',
    'fill',
    'fill an input (replace its value)',
    (_opts, args) => ({ selector: args[0], value: args[1] }),
    (c) => c.argument('<selector>').argument('<value>'),
  );
  register(
    program,
    'type',
    'type',
    'type text into an input (per keystroke)',
    (_opts, args) => ({ selector: args[0], text: args[1] }),
    (c) => c.argument('<selector>').argument('<text>'),
  );
  register(
    program,
    'press',
    'press',
    'press a key or combo (e.g. Enter, Control+c, Meta+s, Shift+Tab)',
    (opts, args) => ({ selector: opts.selector, key: args[0] }),
    (c) => c.argument('<key>').option('--selector <css>', 'optional target element'),
  );
  register(
    program,
    'hover',
    'hover',
    'hover an element',
    (_opts, args) => ({ selector: args[0] }),
    (c) => c.argument('<selector>'),
  );
  register(
    program,
    'select',
    'select',
    'select a dropdown option (value or label)',
    (opts, args) => ({ selector: args[0], value: opts.value, label: opts.label }),
    (c) => c.argument('<selector>').option('--value <v>').option('--label <l>'),
  );

  // 滚动 / 视图
  register(
    program,
    'scroll',
    'scroll',
    'scroll the page (direction|amount|selector)',
    (opts, args) => {
      const first = args[0];
      const direction =
        opts.direction ??
        (typeof first === 'string' && ['up', 'down', 'top', 'bottom'].includes(first)
          ? first
          : undefined);
      const amount =
        opts.amount !== undefined
          ? Number(opts.amount)
          : !direction && first !== undefined
            ? Number(first)
            : undefined;
      return { direction, amount, selector: opts.selector };
    },
    (c) =>
      c
        .argument('[direction|amount]', 'up|down|top|bottom or pixel amount')
        .option('--selector <css>', 'scroll a specific element')
        .option('--direction <d>')
        .option('--amount <n>'),
  );
  register(
    program,
    'screenshot',
    'screenshot',
    'capture a screenshot (optionally a single element)',
    (opts) => ({
      path: opts.path,
      fullPage: opts.full,
      format: opts.format,
      selector: opts.selector,
    }),
    (c) =>
      c
        .option('--path <file>', 'write to file (default: base64 to stdout)')
        .option('--selector <css>', 'capture a single element (tab must be active)')
        .option('--full', 'full page (experimental)')
        .option('--format <fmt>', 'png|jpeg', 'png'),
  );

  // 提取
  register(
    program,
    'extract',
    'extract',
    'extract text, a DOM tree, or an article body',
    (opts) => ({
      mode: opts.mode,
      article: opts.article,
      selector: opts.selector,
      offset: opts.offset !== undefined ? Number(opts.offset) : undefined,
      limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
      depth: opts.depth !== undefined ? Number(opts.depth) : undefined,
      visibleOnly: opts.visibleOnly,
      maxChars: opts.maxChars !== undefined ? Number(opts.maxChars) : undefined,
    }),
    (c) =>
      c
        .option('--mode <m>', 'text|structured (default: text)')
        .option('--article', 'extract article body (defuddle)')
        .option('--selector <css>', 'CSS selector (first-level list)')
        .option('--depth <n>', 'structured recursion depth (default 3)')
        .option('--offset <n>', 'skip first N elements of the first-level list')
        .option('--limit <n>', 'max elements of the first-level list (element count)')
        .option('--max-chars <n>', 'truncate text mode per segment (default: no truncation)')
        .option('--prettify', 'pretty-print structured JSON')
        .option('--visible-only', 'filter invisible first-level elements'),
  );
  register(
    program,
    'page-info',
    'get-page-info',
    'show page url/title/viewport/scroll',
    () => ({}),
  );

  // 页面内网络
  register(
    program,
    'fetch',
    'fetch',
    'issue a network request in the page context (with cookies/login)',
    (opts, args) => {
      const headers: Record<string, string> = {};
      for (const h of (opts.header as string[] | undefined) ?? []) {
        const idx = h.indexOf(':');
        if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      }
      return { url: args[0], method: opts.method, headers, body: opts.body, returnType: opts.type };
    },
    (c) =>
      c
        .argument('<url>')
        .option('--method <m>', 'HTTP method', 'GET')
        .option('--header <k:v>', 'repeatable header', collect, [])
        .option('--body <data>')
        .option('--type <t>', 'text|json|binary', 'text'),
  );
  register(
    program,
    'search',
    'search',
    'search the web (paged: add --page N for later results)',
    (opts, args) => ({
      query: args[0],
      engine: opts.engine,
      page: opts.page !== undefined ? Number(opts.page) : undefined,
    }),
    (c) =>
      c
        .argument('<query>')
        .option('--engine <e>', 'search engine (google|duckduckgo; default google)')
        .option('--page <n>', 'result page (1-based; google=10/page, duckduckgo=30/page)', '1'),
  );

  // 标签页
  register(program, 'tabs', 'list-tabs', 'list browser tabs', () => ({}));
  register(
    program,
    'tab',
    'activate-tab',
    'activate a tab',
    (_opts, args) => ({ tabId: Number(args[0]) }),
    (c) => c.argument('<tabId>'),
  );
  register(
    program,
    'tab-new',
    'create-tab',
    'open a new tab',
    (_opts, args) => ({ url: args[0] }),
    (c) => c.argument('<url>'),
  );
  register(
    program,
    'tab-close',
    'close-tab',
    'close a tab (default: current)',
    (_opts, args) => ({ tabId: args[0] !== undefined ? Number(args[0]) : undefined }),
    (c) => c.argument('[tabId]'),
  );

  // 等待
  register(
    program,
    'wait',
    'wait',
    'wait for time / element / condition',
    (opts) => ({
      ms: opts.ms !== undefined ? Number(opts.ms) : undefined,
      selector: opts.selector,
      condition: opts.condition,
    }),
    (c) =>
      c.option('--ms <n>').option('--selector <css>').option('--condition <c>', 'networkidle|load'),
  );

  // 启动 relay server（npm -g 安装后的便捷入口）
  program
    .command('serve')
    .description('run the parkinglot relay server (blocks; default http://127.0.0.1:8787)')
    .option('--port <n>', 'listen port')
    .option('--token <t>', 'pairing token (default: persisted auto-generated)')
    .action(async function (this: Command) {
      const opts = this.opts() as { port?: string; token?: string };
      const overrides: Partial<Parameters<typeof startServer>[0]> = {};
      if (opts.port !== undefined) overrides.port = Number(opts.port);
      if (opts.token !== undefined) overrides.token = opts.token;
      const running = await startServer(overrides);
      console.log(`parkinglot-server listening on ${running.url}`);
      console.log(`extension websocket: ${running.wsPath}`);
      console.log(`pair token: ${running.token}`);
      console.log(
        'load the extension, pair it with this token, then use `plt status`; Ctrl-C to stop.',
      );
      const shutdown = async (): Promise<void> => {
        await running.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    });

  // 会话管理（server 本地操作）
  program
    .command('session')
    .description('manage sessions (continuity units)')
    .argument('<action>', 'list|new|use|close')
    .argument('[id]', 'session id (use/close)')
    .action(async function (this: Command, action: string, id: string | undefined) {
      const opts = this.optsWithGlobals() as Record<string, unknown>;
      const g = globalOptsFrom(opts);
      if (action === 'list') {
        const status = await fetchStatus(g);
        if ('error' in status) {
          printError({ code: 'EXTENSION_OFFLINE', message: String(status.error) }, g);
          process.exitCode = 4;
          return;
        }
        const sessions = (status.sessions ?? []) as Array<{
          id: string;
          tabId?: number;
          lastUsedAt: string;
        }>;
        for (const s of sessions) {
          const def = status.defaultSessionId === s.id ? ' (default)' : '';
          console.log(`${s.id}${def}  tab=${s.tabId ?? '-'}  last=${s.lastUsedAt}`);
        }
        return;
      }
      const map: Record<string, 'new' | 'use' | 'close'> = {
        new: 'new',
        use: 'use',
        close: 'close',
      };
      const act = map[action];
      if (!act) {
        console.error(`unknown session action '${action}' (list|new|use|close)`);
        process.exitCode = 2;
        return;
      }
      const res = await callSession(act, g, { id });
      if ('error' in res) {
        console.error(`✖ ${String(res.error)}`);
        process.exitCode = 3;
        return;
      }
      const s = res.session as { id?: string; tabId?: number } | undefined;
      console.log(
        `session ${s?.id ?? '?'} ${res.ok ? (act === 'close' ? 'closed' : 'ok') : 'not found'}${s?.tabId !== undefined ? ` tab=${s.tabId}` : ''}`,
      );
    });

  // 日志
  program
    .command('logs')
    .description('show the command ledger')
    .option('--tail <n>', 'last N entries', '100')
    .option('--follow', 'follow new entries', false)
    .action(async function (this: Command, opts: Record<string, unknown>) {
      const g = globalOptsFrom(this.optsWithGlobals());
      void opts;
      const tail = Number(this.optsWithGlobals().tail) || 100;
      const res = await fetchLedger(g, tail);
      if ('error' in res) {
        console.error(`✖ ${String(res.error)}`);
        process.exitCode = 4;
        return;
      }
      for (const e of res.entries) console.log(JSON.stringify(e));
      if (this.optsWithGlobals().follow) {
        const timer = setInterval(async () => {
          const next = await fetchLedger(g, 0);
          if (!('error' in next)) {
            for (const e of next.entries) console.log(JSON.stringify(e));
          }
        }, 1000);
        timer.unref();
      }
    });

  // 事件（tab 生命周期；拉取后清空未读）
  program
    .command('events')
    .description('show recent tab lifecycle events (and clear the unread count)')
    .option('--tail <n>', 'last N events', '100')
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals() as Record<string, unknown>;
      const g = globalOptsFrom(opts);
      const res = await fetchEvents(g);
      if ('error' in res) {
        console.error(`✖ ${String(res.error)}`);
        process.exitCode = 4;
        return;
      }
      const tail = Number(opts.tail) || 100;
      const events = res.events.slice(-tail);
      if (g.json) {
        console.log(JSON.stringify({ unreadCount: res.unreadCount, events }));
        return;
      }
      for (const e of events) {
        const { tabId, windowId, url } = e.params as {
          tabId?: number;
          windowId?: number;
          url?: string;
        };
        const extra = url ? ` ${url}` : '';
        console.log(`${e.ts}  ${e.event}  tab=${tabId ?? '-'} win=${windowId ?? '-'}${extra}`);
      }
      if (events.length === 0) console.log('(no events)');
    });

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function globalOptsFrom(opts: Record<string, unknown>): GlobalOpts {
  return {
    server: String(opts.server ?? 'http://127.0.0.1:8787'),
    json: Boolean(opts.json),
    timeout: String(opts.timeout ?? '30000'),
    session: typeof opts.session === 'string' ? opts.session : undefined,
  };
}

// 直接执行：不依赖 import.meta.url 与 argv[1] 的字符串匹配（npm -g symlink 下 argv[1]
// 是软链路径、import.meta.url 是真实路径，旧守卫会误判为“被导入”而静默不执行）。
const program = buildProgram();
void program.parseAsync(process.argv);
