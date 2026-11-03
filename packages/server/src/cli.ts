#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type Method,
  type ProtocolError,
  type Response,
} from '@parklet/protocol';
import { runCollect } from './collect.js';
import { fieldsFromOpts } from './fields.js';
import { startServer } from './index.js';
import { interpolateValue } from './template.js';

/** CLI 版本 = 本包 package.json 的 version（与线协议 PROTOCOL_VERSION 不同概念）。 */
const CLI_PACKAGE_VERSION = (
  createRequire(import.meta.url)('../package.json') as {
    version: string;
  }
).version;

interface GlobalOpts {
  server: string;
  json: boolean;
  timeout: string;
  /** 显式目标 tab（缺省用 server 的当前目标 tab / 最近激活 tab） */
  tab?: number;
  /** screenshot 的 --path（写文件目标） */
  path?: string;
  /** screenshot 的 --format（决定默认落盘后缀） */
  format?: string;
  /** 抑制非错误诊断输出 */
  quiet?: boolean;
}

/** 未提供 --path 时的默认截图文件名（cwd 下，带时间戳）。 */
function defaultScreenshotPath(format?: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  return `screenshot-${stamp}.${format === 'jpeg' ? 'jpeg' : 'png'}`;
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
  const body = { method, params, tabId: opts.tab };
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
        message: `cannot reach server at ${base}: ${(err as Error).message}. Start it with: pnpm --filter @parklet/server start`,
      },
    } satisfies ProtocolError;
  }
  return httpRes;
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
    case 'TAB_CLOSED':
    case 'NO_EFFECT':
    case 'TARGET_NOT_FOUND':
    case 'TARGET_AMBIGUOUS':
    case 'TAB_NOT_ACTIVE':
    case 'URL_INVALID':
    case 'HOST_NOT_ALLOWED':
    case 'EVAL_DISABLED':
    case 'NOT_SERIALIZABLE':
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
  const { context } = result;
  if (!context) return '';
  return `📍 ${context.url} — ${context.title} (navId=${context.navId}, tab=${context.tabId})`;
}

/** links / forms 的分页提示行（total 存在时打印）。 */
function paginationLine(
  shown: number,
  d: { total?: number; offset?: number; limit?: number; truncated?: boolean },
): void {
  if (d.truncated === true) console.log('(truncated at collection limit)');
  if (d.total === undefined) return;
  const offset = d.offset !== undefined ? `, offset=${d.offset}` : '';
  const limit = d.limit !== undefined ? `, limit=${d.limit}` : '';
  console.log(`[showing ${shown} of ${d.total}${offset}${limit}]`);
}

function printLinks(d: {
  links?: Array<{ href: string; texts: string[]; count: number }>;
  total?: number;
  offset?: number;
  limit?: number;
  truncated?: boolean;
}): void {
  const links = d.links ?? [];
  for (const l of links) {
    const label = l.texts.length > 0 ? l.texts.join(' | ') : '(no text)';
    const times = l.count > 1 ? ` (x${l.count})` : '';
    console.log(`- ${label} -> ${l.href}${times}`);
  }
  paginationLine(links.length, d);
}

function printForms(d: {
  forms?: Array<{
    action?: string;
    method?: string;
    target?: string;
    fields: Array<{
      tag: string;
      type: string;
      name?: string;
      value?: string;
      labels: string[];
      checked?: boolean;
      selected?: string[];
      disabled?: boolean;
      required?: boolean;
      id?: string;
    }>;
  }>;
  total?: number;
  offset?: number;
  limit?: number;
  truncated?: boolean;
}): void {
  const forms = d.forms ?? [];
  let fieldCount = 0;
  forms.forEach((form, i) => {
    const head = form.action ?? '(no form)';
    const meta = [form.method, form.target].filter(Boolean).join(' ');
    console.log(`form ${i + 1}: ${head}${meta ? ` [${meta}]` : ''}`);
    for (const f of form.fields) {
      fieldCount += 1;
      const label = f.labels.length > 0 ? f.labels.join(' / ') : '(no label)';
      const name = f.name !== undefined ? ` name=${f.name}` : '';
      const value = f.value !== undefined ? ` value=${JSON.stringify(f.value)}` : '';
      const state =
        f.checked !== undefined
          ? ` checked=${f.checked}`
          : f.selected !== undefined
            ? ` selected=${JSON.stringify(f.selected)}`
            : '';
      const flags = `${f.disabled ? ' disabled' : ''}${f.required ? ' required' : ''}`;
      console.log(`  - <${f.tag} type=${f.type}> ${label}${name}${value}${state}${flags}`);
    }
  });
  paginationLine(fieldCount, d);
}

function printResult(method: string, result: Response['result'], opts: GlobalOpts): void {
  const ctx = formatContext(result);
  if (ctx.length > 0 && opts.quiet !== true) console.error(ctx);
  if (opts.json) {
    console.log(
      JSON.stringify({
        tabId: result.tabId,
        context: result.context,
        data: result.data,
      }),
    );
    return;
  }
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
        currentTabId?: number;
        config?: Record<string, unknown>;
      };
      console.log(`extension: ${d.extensionConnected ? 'connected ✅' : 'offline ❌'}`);
      console.log(`current tab: ${d.currentTabId ?? '-'}`);
      break;
    }
    case 'extract': {
      const d = data as {
        mode?: 'text' | 'structured' | 'html' | 'article' | 'fields' | 'links' | 'forms';
        snapshot?: { visibleText?: string; viewport?: { width: number; height: number } };
        texts?: string[];
        nodes?: unknown;
        items?: unknown[];
        links?: unknown;
        forms?: unknown;
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
      const shown = Array.isArray(d.texts)
        ? d.texts.length
        : Array.isArray(d.nodes)
          ? d.nodes.length
          : Array.isArray(d.items)
            ? d.items.length
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
      } else if (d.mode === 'fields' && Array.isArray(d.items)) {
        for (const item of d.items) console.log(JSON.stringify(item));
        if (range) console.log(range);
      } else if (d.mode === 'links') {
        printLinks(d as Parameters<typeof printLinks>[0]);
      } else if (d.mode === 'forms') {
        printForms(d as Parameters<typeof printForms>[0]);
      } else if (Array.isArray(d.texts)) {
        d.texts.forEach((t, i) => console.log(`[${i + 1}] ${t}`));
        if (range) console.log(range);
      } else if (Array.isArray(d.items)) {
        d.items.forEach((html, i) => console.log(`[${i + 1}] ${String(html)}`));
        if (range) console.log(range);
      } else if (d.nodes !== undefined) {
        console.log(JSON.stringify(d.nodes));
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
        readyState?: string;
        visibilityState?: string;
        activeElement?: { tag: string; id?: string; role?: string };
        selection?: string;
        scroll?: { y: number; scrollHeight: number; clientHeight: number };
        selector?: { count: number; box?: { x: number; y: number; width: number; height: number } };
      };
      console.log(`url: ${d.url}`);
      console.log(`title: ${d.title}`);
      console.log(`viewport: ${d.viewport?.width}x${d.viewport?.height}  scrollY: ${d.scrollY}`);
      console.log(
        `state: ${d.readyState ?? '?'} / ${d.visibilityState ?? '?'}` +
          (d.activeElement
            ? `  active: <${d.activeElement.tag}${d.activeElement.id ? `#${d.activeElement.id}` : ''}>`
            : ''),
      );
      if (d.selection !== undefined && d.selection.length > 0) {
        console.log(`selection: ${d.selection}`);
      }
      if (d.selector !== undefined) {
        const box = d.selector.box
          ? ` @(${d.selector.box.x},${d.selector.box.y},${d.selector.box.width}x${d.selector.box.height})`
          : '';
        console.log(`selector: ${d.selector.count} match(es)${box}`);
      }
      break;
    }
    case 'eval': {
      const d = data as { value?: unknown };
      if (d.value === undefined) {
        console.log('(no return value)');
      } else if (typeof d.value === 'string') {
        console.log(d.value);
      } else {
        console.log(JSON.stringify(d.value, null, 2));
      }
      break;
    }
    case 'selection': {
      const d = data as { text?: string };
      console.log(d.text ?? '');
      break;
    }
    case 'dom-query': {
      const d = data as {
        matches?: Array<{ tag: string; class?: string; id?: string; text?: string }>;
        total?: number;
      };
      for (const m of d.matches ?? []) {
        const id = m.id !== undefined ? `#${m.id}` : '';
        const cls = m.class !== undefined ? `.${m.class.split(/\s+/).join('.')}` : '';
        console.log(`<${m.tag}${id}${cls}> ${(m.text ?? '').slice(0, 100)}`);
      }
      console.log(`(${d.matches?.length ?? 0} of ${d.total ?? 0})`);
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
    case 'scroll-to': {
      const d = data as {
        element?: { tag: string; text?: string; box?: { x: number; y: number } };
        before?: { y: number };
        after?: { y: number };
        delta?: { y: number };
        settled?: boolean;
        warning?: string;
      };
      const el = d.element;
      const box = el?.box ? ` @(${el.box.x},${el.box.y})` : '';
      const y =
        d.before !== undefined && d.after !== undefined
          ? ` y ${d.before.y} -> ${d.after.y} (Δ${d.delta?.y ?? '?'})`
          : '';
      console.log(`⚡ <${el?.tag ?? '?'}> ${el?.text ?? ''}${box}${y}`);
      if (d.warning === 'BACKGROUND_TAB' && opts.quiet !== true) {
        console.error('⚠ target tab is in the background; scroll may be throttled (use --focus)');
      }
      break;
    }
    case 'scroll': {
      const d = data as {
        target?: 'page' | { selector?: string };
        before?: { x: number; y: number };
        after?: { x: number; y: number };
        delta?: { x: number; y: number };
        atTop?: boolean;
        atBottom?: boolean;
        settled?: boolean;
        warning?: string;
      };
      const target =
        d.target === 'page' || d.target === undefined
          ? 'page'
          : `element ${d.target.selector ?? '?'}`;
      const y = `y ${d.before?.y ?? '?'} -> ${d.after?.y ?? '?'} (Δ${d.delta?.y ?? '?'})`;
      const flags = `${d.atTop ? ' [top]' : ''}${d.atBottom ? ' [bottom]' : ''}${d.settled === false ? ' [unsettled]' : ''}`;
      console.log(`scrolled ${target}: ${y}${flags}`);
      if (d.warning === 'BACKGROUND_TAB' && opts.quiet !== true) {
        console.error('⚠ target tab is in the background; scroll may be throttled (use --focus)');
      }
      break;
    }
    case 'screenshot': {
      const d = data as { data?: string; path?: string };
      if (typeof d.data !== 'string') {
        console.log('📸 (no image data)');
        break;
      }
      // 未显式指定路径时默认写文件（cwd 下带时间戳），并打印绝对路径
      const target = d.path ?? opts.path ?? defaultScreenshotPath(opts.format);
      writeFileSync(target, Buffer.from(d.data, 'base64'));
      console.log(`📸 saved to ${resolve(target)}`);
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
    case 'wait': {
      const d = data as { matched?: number; waitedMs?: number; stable?: boolean };
      console.log(
        `waited ${d.waitedMs ?? '?'}ms${d.matched !== undefined ? `, matched ${d.matched}` : ''}${d.stable === false ? ', unstable' : ''}`,
      );
      break;
    }
    case 'goto':
    case 'back':
    case 'forward':
    case 'reload':
    case 'activate-tab':
    case 'create-tab':
      break;
    default:
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
    try {
      const commandObj = rawArgs.pop() as Command;
      const opts = commandObj.optsWithGlobals() as Record<string, unknown>;
      const args = rawArgs as string[];
      void run(method, buildParams(opts, args), opts).catch((err: unknown) => {
        console.error(`✖ ${(err as Error).message ?? String(err)}`);
        process.exitCode = 1;
      });
    } catch (err) {
      console.error(`✖ ${(err as Error).message ?? String(err)}`);
      process.exitCode = 2;
    }
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
    tab: opts.tab !== undefined ? Number(opts.tab) : undefined,
    path: typeof opts.path === 'string' ? opts.path : undefined,
    format: typeof opts.format === 'string' ? opts.format : undefined,
    quiet: Boolean(opts.quiet),
  };
  const res = await callCommand(method, params, g);
  if ('error' in res) {
    printError(res.error, g);
    process.exitCode = exitCodeFor(res.error.code);
  } else {
    printResult(method, res.result, g);
    process.exitCode = 0;
  }
}

export function buildProgram(): Command {
  const program = new Command()
    .name('plt')
    .description('Parklet: drive a real browser owned by the human user')
    .version(`${CLI_PACKAGE_VERSION} (protocol ${PROTOCOL_VERSION})`)
    .option('--server <url>', 'server base URL', 'http://127.0.0.1:8787')
    .option('--json', 'output structured JSON (envelope)')
    .option('--timeout <ms>', 'command timeout in milliseconds', '30000')
    .option('--tab <id>', 'target tab id (defaults to the server current tab / last active tab)')
    .option('--quiet', 'suppress non-error diagnostics on stderr')
    .addHelpText(
      'after',
      `
Examples:
  plt goto https://example.com     navigate (sets the current tab)
  plt extract --article            article body as Markdown
  plt extract --mode structured --selector "article ul" --limit 10
  plt screenshot                   save screenshot-<timestamp>.png in the cwd
  plt press Control+c              Playwright-style key combo

Exit codes:
  0 success · 2 invalid params · 3 target error · 4 extension offline · 6 timeout · 1 other

Run \`plt <command> --help\` for command-specific options.`,
    );

  // 会话 / 状态
  register(
    program,
    'status',
    'get-status',
    'show server, extension and current-tab status',
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
    (c) => c.argument('<selector>', 'CSS selector'),
  );
  register(
    program,
    'click-text',
    'click-text',
    'click an actionable element by visible text',
    (opts, args) => ({
      text: args[0],
      within: opts.within,
      role: opts.role,
      exact: opts.exact === true ? true : undefined,
      nth: opts.nth !== undefined ? Number(opts.nth) : undefined,
    }),
    (c) =>
      c
        .argument('<text>', 'visible text')
        .option('--within <css>', 'limit the search to this scope')
        .option('--role <role>', 'only match this role (button/link/tab/...)')
        .option('--exact', 'match the full normalized text')
        .option('--nth <n>', 'pick the nth match (0-based, DOM order)'),
  );
  register(
    program,
    'fill',
    'fill',
    'fill an input (replace its value)',
    (_opts, args) => ({ selector: args[0], value: args[1] }),
    (c) =>
      c
        .argument('<selector>', 'CSS selector, or a label/container holding the input')
        .argument('<value>', 'value to set'),
  );
  register(
    program,
    'type',
    'type',
    'type text into an input (per keystroke)',
    (_opts, args) => ({ selector: args[0], text: args[1] }),
    (c) =>
      c
        .argument('<selector>', 'CSS selector, or a label/container holding the input')
        .argument('<text>', 'text to type'),
  );
  register(
    program,
    'press',
    'press',
    'press a key or combo (e.g. Enter, Control+c, Meta+s, Shift+Tab)',
    (opts, args) => ({ selector: opts.selector, key: args[0] }),
    (c) =>
      c
        .argument('<key>', 'key or combo; single char or named key')
        .option('--selector <css>', 'optional target element (default: focused element)'),
  );
  register(
    program,
    'hover',
    'hover',
    'hover an element',
    (_opts, args) => ({ selector: args[0] }),
    (c) => c.argument('<selector>', 'CSS selector'),
  );
  register(
    program,
    'select',
    'select',
    'select a dropdown option (value or label)',
    (opts, args) => ({ selector: args[0], value: opts.value, label: opts.label }),
    (c) =>
      c
        .argument('<selector>', 'CSS selector for the <select>')
        .option('--value <v>', 'option value')
        .option('--label <l>', 'option label (substring match)'),
  );
  register(
    program,
    'selection',
    'selection',
    'select text on the page (by CSS selector or visible text)',
    (opts) => ({ selector: opts.selector, text: opts.text }),
    (c) =>
      c
        .option('--selector <css>', 'CSS selector of the element to select')
        .option('--text <text>', 'visible text of the element to select'),
  );

  // 滚动 / 视图
  register(
    program,
    'scroll',
    'scroll',
    'scroll the page or an element (--by/--to; --selector for inner scroll)',
    (opts) => ({
      by: opts.by !== undefined ? Number(opts.by) : undefined,
      to: opts.to,
      selector: opts.selector,
      smooth: opts.smooth === true ? true : undefined,
      settle: opts.settle !== false,
      focus: opts.focus === true ? true : undefined,
      allowNoop: opts.allowNoop === true ? true : undefined,
    }),
    (c) =>
      c
        .option('--by <px>', 'scroll by pixels (negative = up)')
        .option('--to <edge>', 'top|bottom')
        .option('--selector <css>', 'scroll inside this element (overflow container)')
        .option('--smooth', 'use smooth scrolling')
        .option('--no-settle', 'do not wait for the scroll position to settle')
        .option('--focus', 'activate the target tab before scrolling')
        .option('--allow-noop', 'allow a scroll with no effect (delta=0)'),
  );
  register(
    program,
    'scroll-to',
    'scroll-to',
    'scroll the page so the element is in view',
    (opts, args) => ({
      selector: args[0],
      smooth: opts.smooth === true ? true : undefined,
      settle: opts.settle !== false,
      focus: opts.focus === true ? true : undefined,
    }),
    (c) =>
      c
        .argument('<selector>', 'CSS selector to bring into view')
        .option('--smooth', 'use smooth scrolling')
        .option('--no-settle', 'do not wait for the scroll position to settle')
        .option('--focus', 'activate the target tab before scrolling'),
  );
  register(
    program,
    'screenshot',
    'screenshot',
    'capture a screenshot (optionally a single element)',
    (opts) => ({
      path: opts.path,
      format: opts.format,
      selector: opts.selector,
      restoreFocus: opts.restoreFocus === true ? true : undefined,
    }),
    (c) =>
      c
        .option('--path <file>', 'output file (default: screenshot-<timestamp>.png)')
        .option('--selector <css>', 'capture a single element (auto-activates the tab)')
        .option('--restore-focus', 'restore the previously active tab after capture')
        .option('--format <fmt>', 'png|jpeg', 'png'),
  );

  // 提取
  register(
    program,
    'extract',
    'extract',
    'extract text / DOM / article / fields / links / forms',
    (opts) => ({
      mode: opts.mode,
      fields: fieldsFromOpts(opts),
      article: opts.article,
      selector: opts.selector ?? opts.within,
      offset: opts.offset !== undefined ? Number(opts.offset) : undefined,
      limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
      depth: opts.depth !== undefined ? Number(opts.depth) : undefined,
      visibleOnly: opts.all === true ? false : opts.visibleOnly,
      maxChars: opts.maxChars !== undefined ? Number(opts.maxChars) : undefined,
      exclude: opts.exclude,
    }),
    (c) =>
      c
        .option('--mode <m>', 'text|structured|html|links|forms (default: text)')
        .option('--all', 'include invisible elements (links/forms)')
        .option('--fields <spec>', 'structured fields: name=selector[@attr][|fallback],...')
        .option('--fields-file <json>', 'JSON array of {name,selector,attr?,alternatives?}')
        .option('--article', 'extract article body (defuddle)')
        .option('--selector <css>', 'CSS selector (first-level list / row selector)')
        .option('--within <css>', 'alias for --selector')
        .option('--depth <n>', 'structured recursion depth (default 3)')
        .option('--offset <n>', 'skip first N elements of the first-level list')
        .option('--limit <n>', 'max elements of the first-level list (element count)')
        .option('--max-chars <n>', 'truncate text mode per segment (default: no truncation)')
        .option('--exclude <css>', 'drop elements matching this CSS before extracting')
        .option('--visible-only', 'filter invisible first-level elements'),
  );
  register(
    program,
    'page-info',
    'get-page-info',
    'show page url/title/viewport/scroll/state',
    (opts) => ({ selector: opts.selector }),
    (c) => c.option('--selector <css>', 'also report match count and first box'),
  );
  register(
    program,
    'dom-query',
    'dom-query',
    'list elements matching a CSS selector or visible text (exploration)',
    (opts, args) => ({
      selector: args[0] ?? opts.selector,
      text: opts.text,
      limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
    }),
    (c) =>
      c
        .argument('[selector]', 'CSS selector')
        .option('--selector <css>', 'CSS selector (alternative to positional)')
        .option('--text <text>', 'match by visible text')
        .option('--limit <n>', 'max matches (default 20)'),
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
        .argument('<url>', 'URL to request from the page context')
        .option('--method <m>', 'HTTP method', 'GET')
        .option(
          '--header <k:v>',
          'repeatable header (e.g. --header "Accept: application/json")',
          collect,
        )
        .option('--body <data>', 'request body')
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
        .argument('<query>', 'search query')
        .option('--engine <e>', 'search engine (google|duckduckgo; default google)')
        .option('--page <n>', 'result page (1-based; google=10/page, duckduckgo=30/page)', '1'),
  );

  // 标签页
  register(program, 'tabs', 'list-tabs', 'list browser tabs', () => ({}));
  register(
    program,
    'tab',
    'activate-tab',
    'activate a tab and make it the current tab',
    (_opts, args) => ({ tabId: Number(args[0]) }),
    (c) => c.argument('<tabId>', 'tab id to activate (see `plt tabs`)'),
  );
  register(
    program,
    'tab-new',
    'create-tab',
    'open a new tab, activate it and make it current',
    (_opts, args) => ({ url: args[0] }),
    (c) => c.argument('<url>', 'URL to open'),
  );
  register(
    program,
    'tab-close',
    'close-tab',
    'close a tab (default: current)',
    (opts, args) => {
      if (opts.tab !== undefined && args[0] !== undefined) {
        throw new Error('tab-close: use either --tab <id> or a positional tab id, not both');
      }
      return { tabId: args[0] !== undefined ? Number(args[0]) : undefined };
    },
    (c) => c.argument('[tabId]', 'tab id (default: the current tab)'),
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
      count: opts.count !== undefined ? Number(opts.count) : undefined,
      stableMs: opts.stable !== undefined ? Number(opts.stable) : undefined,
      condition: opts.condition,
    }),
    (c) =>
      c
        .option('--ms <n>')
        .option('--selector <css>')
        .option('--count <n>', 'wait until at least N elements match')
        .option('--stable <ms>', 'wait until the count is unchanged for N ms')
        .option('--condition <c>', 'networkidle|load|content'),
  );

  // 高级：页面脚本执行（默认禁用，需 server 侧 PARKLET_ENABLE_EVAL=1）
  register(
    program,
    'eval',
    'eval',
    'run a script in the page context (must contain `return`; server must enable eval)',
    (opts, args) => ({ script: resolveEvalScript(opts, args) }),
    (c) =>
      c
        .argument('[script]', 'inline script (must contain `return`)')
        .option('--file <path>', 'read the script from a file')
        .option('--stdin', 'read the script from stdin'),
  );

  // 批量采集：extract --fields + scroll 的固定轮次编排
  program
    .command('collect')
    .description('collect rows while scrolling a fixed number of times (fields + repeat)')
    .argument('<selector>', 'row selector (e.g. article[data-testid="tweet"])')
    .option('--fields <spec>', 'name=selector[@attr][|fallback],...')
    .option('--fields-file <json>', 'JSON array of {name,selector,attr?,alternatives?}')
    .option('--repeat <n>', 'number of scroll rounds (required, >= 1)')
    .option('--scroll-by <px>', 'pixels per scroll (default: 0.8 viewport, capped at viewport)')
    .option('--max-items <n>', 'stop after N items', '10000')
    .option('--dedupe-key <fields>', 'comma-separated dedupe fields (default: id / author,text)')
    .option('--dedupe-prefix <n>', 'use first N chars of text fields for dedupe', '0')
    .option('--no-dedupe', 'do not de-duplicate')
    .option('--no-focus', 'do not activate the target tab before collecting')
    .option('--jsonl', 'print one item per line; summary goes to stderr')
    .action(async function (this: Command, selector: string) {
      const opts = this.optsWithGlobals() as Record<string, unknown>;
      const g = globalOptsFrom(opts);
      try {
        const fields = fieldsFromOpts(opts);
        if (fields === undefined) throw new Error('collect requires --fields or --fields-file');
        const repeat = Number(opts.repeat);
        if (!Number.isFinite(repeat)) throw new Error('collect requires --repeat <n>');
        const jsonl = opts.jsonl === true;
        if (jsonl && g.json) throw new Error('use only one of --json and --jsonl');

        const send = async (
          method: string,
          params: Record<string, unknown>,
          tabId?: number,
        ): Promise<Record<string, unknown>> => {
          const scoped: GlobalOpts = tabId !== undefined ? { ...g, tab: tabId } : g;
          const res = await callCommand(method, params, scoped);
          if ('error' in res) {
            throw Object.assign(new Error(res.error.message), {
              code: res.error.code,
              data: res.error.data,
            });
          }
          return (res.result.data ?? {}) as Record<string, unknown>;
        };

        const report = await runCollect(send, {
          selector,
          fields,
          repeat,
          scrollBy: opts.scrollBy !== undefined ? Number(opts.scrollBy) : undefined,
          maxItems: Number(opts.maxItems ?? 10000),
          dedupe: opts.dedupe !== false,
          dedupeKey: typeof opts.dedupeKey === 'string' ? opts.dedupeKey : undefined,
          dedupePrefix: Number(opts.dedupePrefix ?? 0),
          focus: opts.focus !== false,
          tabId: g.tab,
        });

        if (g.json) {
          console.log(JSON.stringify(report));
        } else {
          for (const item of report.items) console.log(JSON.stringify(item));
          const summary = {
            total: report.total,
            scrolls: report.scrolls,
            duplicates: report.duplicates,
            zeroNewSteps: report.zeroNewSteps,
            stoppedReason: report.stoppedReason,
            ...(report.observed !== undefined ? { observed: report.observed } : {}),
          };
          if (g.quiet !== true) console.error(JSON.stringify(summary));
        }
        process.exitCode = 0;
      } catch (err) {
        const e = err as Error & { code?: ErrorCode };
        if (g.json) {
          console.log(
            JSON.stringify({ error: { code: e.code ?? 'INTERNAL', message: e.message } }),
          );
        } else {
          console.error(`✖ [${e.code ?? 'INTERNAL'}] ${e.message}`);
        }
        process.exitCode = exitCodeFor(e.code);
      }
    });

  // 启动 relay server（npm -g 安装后的便捷入口）
  program
    .command('serve')
    .description('run the parklet relay server (blocks; default http://127.0.0.1:8787)')
    .option('--port <n>', 'listen port')
    .option('--token <t>', 'pairing token (default: persisted auto-generated)')
    .action(async function (this: Command) {
      const opts = this.opts() as { port?: string; token?: string };
      const overrides: Partial<Parameters<typeof startServer>[0]> = {};
      if (opts.port !== undefined) overrides.port = Number(opts.port);
      if (opts.token !== undefined) overrides.token = opts.token;
      const running = await startServer(overrides);
      console.log(`parklet-server listening on ${running.url}`);
      console.log(`extension websocket: ${running.wsPath}`);
      console.log(`pair token: ${running.token}`);
      console.log(
        'load the extension, pair it with this token, then use `plt status`; Ctrl-C to stop.',
      );
      let shuttingDown = false;
      const shutdown = async (): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('\nshutting down…');
        // 兜底超时：即使个别连接未能及时关闭也强制退出
        await Promise.race([running.close(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    });

  // 批量执行：一次进程按顺序执行多条命令（JSON lines）
  program
    .command('run')
    .description('run a batch of commands from a JSON-lines file (or stdin), one per line')
    .argument('[file]', "file with one {method, params?, tabId?, as?} per line ('-' = stdin)")
    .option('--fail-fast', 'stop at the first error', false)
    .option('--var <k=v>', 'set a variable (repeatable)', collect)
    .action(async function (this: Command, file: string | undefined) {
      const globals = this.optsWithGlobals() as Record<string, unknown>;
      const g = globalOptsFrom(globals);
      const failFast = Boolean(this.opts().failFast);
      const vars: Record<string, unknown> = {};
      for (const item of (this.opts().var as string[] | undefined) ?? []) {
        const eq = item.indexOf('=');
        if (eq <= 0) {
          console.error(`✖ invalid --var '${item}' (expected k=v)`);
          process.exitCode = 2;
          return;
        }
        vars[item.slice(0, eq)] = item.slice(eq + 1);
      }
      const raw =
        file === undefined || file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
      const lines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      let failures = 0;
      let index = 0;
      for (const line of lines) {
        index += 1;
        let entry: {
          method?: string;
          params?: unknown;
          tabId?: number;
          vars?: Record<string, unknown>;
          as?: string;
        };
        try {
          entry = JSON.parse(line) as typeof entry;
        } catch {
          failures += 1;
          console.error(`#${index}: invalid JSON line`);
          if (failFast) break;
          continue;
        }
        if (entry.vars !== undefined) {
          if (entry.vars === null || typeof entry.vars !== 'object') {
            failures += 1;
            console.error(`#${index}: 'vars' must be an object`);
            if (failFast) break;
            continue;
          }
          Object.assign(vars, entry.vars);
          if (entry.method === undefined) continue;
        }
        if (typeof entry.method !== 'string') {
          failures += 1;
          console.error(`#${index}: missing 'method'`);
          if (failFast) break;
          continue;
        }
        const g2: GlobalOpts = entry.tabId !== undefined ? { ...g, tab: entry.tabId } : g;
        if (!g.json && g.quiet !== true) console.error(`#${index} ${entry.method}`);
        let params: Record<string, unknown>;
        try {
          params = interpolateValue(entry.params ?? {}, vars) as Record<string, unknown>;
        } catch (err) {
          failures += 1;
          console.error(`#${index}: ${(err as Error).message}`);
          if (failFast) {
            process.exitCode = 2;
            return;
          }
          continue;
        }
        const res = await callCommand(entry.method, params, g2);
        if ('error' in res) {
          failures += 1;
          printError(res.error, g);
          if (failFast) {
            process.exitCode = exitCodeFor(res.error.code);
            return;
          }
        } else {
          if (entry.as !== undefined) {
            vars[entry.as] = res.result.data ?? {};
          }
          if (g.json) {
            console.log(JSON.stringify({ ...res.result }));
          } else {
            printResult(entry.method, res.result, g2);
          }
        }
      }
      if (failures > 0) process.exitCode = 1;
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

  // 帮助分组（commander helpGroup）：让命令列表按用途归类，更易扫读
  const GROUPS: Record<string, string> = {
    goto: 'Navigation',
    back: 'Navigation',
    forward: 'Navigation',
    reload: 'Navigation',
    click: 'Interaction',
    'click-text': 'Interaction',
    fill: 'Interaction',
    type: 'Interaction',
    press: 'Interaction',
    hover: 'Interaction',
    select: 'Interaction',
    selection: 'Interaction',
    scroll: 'View',
    'scroll-to': 'View',
    screenshot: 'View',
    extract: 'Extraction',
    'page-info': 'Extraction',
    'dom-query': 'Extraction',
    fetch: 'Network',
    search: 'Network',
    tabs: 'Tabs',
    tab: 'Tabs',
    'tab-new': 'Tabs',
    'tab-close': 'Tabs',
    wait: 'Wait',
    status: 'Session',
    ping: 'Session',
    eval: 'Advanced',
    logs: 'Ops',
    events: 'Ops',
    run: 'Ops',
    collect: 'Ops',
    serve: 'Server',
  };
  for (const cmd of program.commands) {
    const group = GROUPS[cmd.name()];
    if (group !== undefined) cmd.helpGroup(group);
  }

  return program;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** 解析 eval 的脚本来源：inline / --file / --stdin 三选一。 */
function resolveEvalScript(opts: Record<string, unknown>, args: string[]): string {
  const inline = args[0];
  const fromFile = typeof opts.file === 'string' ? opts.file : undefined;
  const fromStdin = Boolean(opts.stdin);
  const count = [inline !== undefined, fromFile !== undefined, fromStdin].filter(Boolean).length;
  if (count === 0) {
    console.error('✖ eval needs a script: `plt eval "<script>"`, `--file <path>`, or `--stdin`');
    process.exit(2);
  }
  if (count > 1) {
    console.error('✖ eval accepts only one of: inline script, --file, --stdin');
    process.exit(2);
  }
  if (fromFile !== undefined) return readFileSync(fromFile, 'utf8');
  if (fromStdin) return readFileSync(0, 'utf8');
  return inline!;
}

function globalOptsFrom(opts: Record<string, unknown>): GlobalOpts {
  return {
    server: String(opts.server ?? 'http://127.0.0.1:8787'),
    json: Boolean(opts.json),
    timeout: String(opts.timeout ?? '30000'),
    tab: opts.tab !== undefined ? Number(opts.tab) : undefined,
    quiet: Boolean(opts.quiet),
  };
}

// 直接执行：不依赖 import.meta.url 与 argv[1] 的字符串匹配（npm -g symlink 下 argv[1]
// 是软链路径、import.meta.url 是真实路径，旧守卫会误判为“被导入”而静默不执行）。
const program = buildProgram();
void program.parseAsync(process.argv);
