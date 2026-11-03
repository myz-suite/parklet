import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import {
  command,
  launchExtensionContext,
  runCli,
  startServer,
  startTestWeb,
  waitForExtensionOnline,
  type RunningServer,
} from './support';

export interface Session {
  serverUrl: string;
  page: Page;
  context: BrowserContext;
  sw: Worker;
  server: RunningServer;
  /** 本地夹具站点（source of truth；不依赖任何外部站点） */
  web: { url: string; stop: () => void };
  /** 扩展视角的目标 chrome tabId（create-tab 返回，命令显式携带） */
  tabId: number;
}

// 扩展会话 fixture：每次 launch 独立 profile 并自动配对、create-tab 开本地夹具首页，
// 用例结束自动关闭 context、web server 并清理 profile（避免 chromium 进程泄漏导致后续用例不稳定）。
export const test = base.extend<{ session: Session }>({
  session: [
    async ({}, use) => {
      const server = await startServer({ enableEval: true });
      const web = await startTestWeb();
      let session: Session;
      try {
        const { context, sw, profileDir } = await launchExtensionContext(server.url, server.token);
        try {
          const before = new Set(context.pages());
          const created = (await command(server.url, 'create-tab', {
            url: `${web.url}/`,
          })) as { data?: { tab?: { id?: number } } };
          const tabId = created.data?.tab?.id;
          if (typeof tabId !== 'number') throw new Error('create-tab did not return a tab id');

          // 通过 context.pages() 差集轮询等待新 tab（避免 'page' 事件在 waitForEvent 之前已触发的竞态）
          let page: Page | undefined;
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            page = context.pages().find((p) => !before.has(p));
            if (page !== undefined) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          if (page === undefined) throw new Error('create-tab did not open a page');
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          session = { serverUrl: server.url, page, context, sw, server, web, tabId };
        } finally {
          // 若 fixture 内初始化失败也要关浏览器
          if (!session) await context.close().catch(() => {});
        }
        await use(session);
        await context.close().catch(() => {});
        rmSync(profileDir, { recursive: true, force: true });
      } finally {
        web.stop();
        server.stop();
      }
    },
    { scope: 'test' },
  ],
});

test('扩展自动配对并保持连接', async ({ session }) => {
  const ping = (await command(session.serverUrl, 'ping', {})) as {
    data?: { pong?: string; extensionConnected?: boolean };
  };
  expect(ping.data?.pong).toBe('pong');
  expect(ping.data?.extensionConnected).toBe(true);
});

test('goto 驱动本地页面并返回 context 快照', async ({ session }) => {
  const url = `${session.web.url}/target-page`;
  const goto = (await command(session.serverUrl, 'goto', { url }, { tabId: session.tabId })) as {
    context?: { url?: string; navId?: number };
  };

  expect(goto.context?.url).toBe(url);
  expect(goto.context?.navId).toBeGreaterThanOrEqual(1);
  await session.page.waitForURL(url, { timeout: 20_000 });
  expect(session.page.url()).toBe(url);
});

test('当前 tab 连续性：后续命令复用同一目标并感知导航', async ({ session }) => {
  // 首次 goto 设置当前目标 tab
  const url = `${session.web.url}/list`;
  const goto = (await command(session.serverUrl, 'goto', { url }, { tabId: session.tabId })) as {
    tabId?: number;
    context?: { url?: string };
  };
  await session.page.waitForURL(url, { timeout: 20_000 });
  expect(goto.tabId).toBe(session.tabId);

  // 后续命令不带 tabId：走当前目标 tab（连续性），context 应一致
  const extract = (await command(session.serverUrl, 'extract', {})) as {
    tabId?: number;
    context?: { url?: string };
    data?: { snapshot?: { visibleText?: string } };
  };
  expect(extract.tabId).toBe(goto.tabId);
  expect(extract.context?.url).toBe(url);
  expect(extract.data?.snapshot?.visibleText).toContain('Item 0');
});

test('tab：激活即 current；tab-close 清除并回退', async ({ session }) => {
  const web = await startTestWeb();
  let otherTabId: number | undefined;
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/list` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/list`, { timeout: 20_000 });

    const created = (await command(session.serverUrl, 'create-tab', {
      url: `${web.url}/query`,
    })) as { data?: { tab?: { id?: number } } };
    otherTabId = created.data?.tab?.id;
    expect(otherTabId).toBeDefined();

    const useA = await runCli(session.serverUrl, ['tab', String(session.tabId)]);
    expect(useA.code).toBe(0);
    const onA = (await command(session.serverUrl, 'get-page-info', {})) as {
      data?: { url?: string };
    };
    expect(onA.data?.url).toBe(`${web.url}/list`);

    const useB = await runCli(session.serverUrl, ['tab', String(otherTabId)]);
    expect(useB.code).toBe(0);
    const onB = (await command(session.serverUrl, 'get-page-info', {})) as {
      data?: { url?: string };
    };
    expect(onB.data?.url).toBe(`${web.url}/query`);

    const close = await runCli(session.serverUrl, ['tab-close', String(otherTabId)]);
    expect(close.code).toBe(0);
    const afterClose = (await command(session.serverUrl, 'get-page-info', {})) as {
      data?: { url?: string };
    };
    expect(afterClose.data?.url).toBe(`${web.url}/list`);

    const conflict = await runCli(session.serverUrl, [
      '--tab',
      String(session.tabId),
      'tab-close',
      String(session.tabId),
    ]);
    expect(conflict.code).toBe(2);
    expect(conflict.stderr).toMatch(/not both/);
  } finally {
    if (otherTabId !== undefined) {
      await command(session.serverUrl, 'close-tab', { tabId: otherTabId }).catch(() => {});
    }
    web.stop();
  }
});

test('点击可见文本可真实导航（navId 递增）', async ({ session }) => {
  // 用本地测试页作为点击目标（外部 iana.org 在本 headless 网络被 reset）
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/`, { timeout: 20_000 });

    const click = (await command(
      session.serverUrl,
      'click-text',
      { text: 'Learn more' },
      { tabId: session.tabId },
    )) as {
      context?: { url?: string; navId?: number };
      data?: { element?: { tag?: string } };
    };
    expect(click.data?.element?.tag).toBe('a');
    // 点击真实导航到同源 /target-page
    await session.page.waitForURL(`${web.url}/target-page`, { timeout: 20_000 });
    expect(session.page.url()).toContain('/target-page');
    // 导航完成后页面内容已更新（DOM 真实改变）
    const after = (await command(session.serverUrl, 'extract', {}, { tabId: session.tabId })) as {
      data?: { snapshot?: { visibleText?: string } };
    };
    expect(after.data?.snapshot?.visibleText).toContain('target-page');
  } finally {
    web.stop();
  }
});

// ---------------------------------------------------------------------------
// 用例（核心回归 + 补充）
// ---------------------------------------------------------------------------

test('连接保活：空闲期间始终保持在线且真实命令可用', async ({ session }) => {
  test.setTimeout(170_000);
  const base = session.serverUrl;
  const start = Date.now();
  let firstOfflineAt: number | undefined;
  // 70s 内持续轮询：不应出现任何 offline 窗口（应用层心跳防止 SW 空闲被回收）
  while (Date.now() - start < 70_000) {
    const res = await fetch(`${base}/api/status`);
    const status = (await res.json()) as { extensionConnected?: boolean };
    if (status.extensionConnected !== true && firstOfflineAt === undefined) {
      firstOfflineAt = Date.now() - start;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  expect(firstOfflineAt).toBeUndefined();
  // 无重试的真实命令（ping 是 server-local，无法证明扩展链路）
  const res = await fetch(`${base}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'extract', params: {}, tabId: session.tabId }),
  });
  const env = (await res.json()) as { error?: { code?: string }; result?: unknown };
  expect(env.error).toBeUndefined();
  expect(env.result).toBeDefined();
});

test('重连：强制终止 SW 后自动重连（alarms 兜底）', async ({ session }) => {
  test.setTimeout(120_000);
  const browser = session.context.browser();
  if (browser !== null) {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('ServiceWorker.stopAllWorkers').catch(() => {});
    await cdp.detach();
  }
  await waitForExtensionOnline(session.serverUrl, 60_000);
  const res = await command(session.serverUrl, 'extract', {}, { tabId: session.tabId });
  expect(res.data).toBeDefined();
});

async function connStateOf(sw: Worker): Promise<string | undefined> {
  return sw.evaluate(async () => {
    const s = await chrome.storage.session.get('connState');
    return typeof s.connState === 'string' ? s.connState : undefined;
  });
}

async function badgeOf(sw: Worker): Promise<{ text: string; color: string }> {
  return sw.evaluate(async () => {
    const text = await chrome.action.getBadgeText({});
    const color = await chrome.action.getBadgeBackgroundColor({});
    const hex = Array.isArray(color)
      ? `#${color
          .slice(0, 3)
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('')}`
      : String(color);
    return { text, color: hex };
  });
}

test('badge：连接成功显示绿色圆点', async ({ session }) => {
  await expect.poll(async () => connStateOf(session.sw), { timeout: 10_000 }).toBe('connected');
  expect(await badgeOf(session.sw)).toEqual({ text: '●', color: '#2ecc40' });
});

test('badge：token 错误显示橙色（auth_failed，不自动重连）', async ({ session }) => {
  await session.sw.evaluate(async () => {
    await chrome.storage.local.set({ token: 'wrong-token' });
  });
  await expect.poll(async () => connStateOf(session.sw), { timeout: 15_000 }).toBe('auth_failed');
  expect(await badgeOf(session.sw)).toEqual({ text: '●', color: '#ff9500' });
});

test('badge：server 停止后显示红色（disconnected）', async ({ session }) => {
  session.server.stop();
  await expect.poll(async () => connStateOf(session.sw), { timeout: 20_000 }).toBe('disconnected');
  expect(await badgeOf(session.sw)).toEqual({ text: '●', color: '#ff3b30' });
});

test('badge：未配置显示橙色（unconfigured）', async () => {
  test.setTimeout(60_000);
  const server = await startServer();
  const { context, sw, profileDir } = await launchExtensionContext(server.url, server.token, {
    autopair: false,
  });
  try {
    await expect.poll(async () => connStateOf(sw), { timeout: 15_000 }).toBe('unconfigured');
    expect(await badgeOf(sw)).toEqual({ text: '●', color: '#ff9500' });
  } finally {
    await context.close().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
    server.stop();
  }
});

test('连接稳定：短时间内多次配置变更后仍恢复并可用', async ({ session }) => {
  const token = session.server.token;
  // 突发多次配置变更（每次都触发重连）；回归：重复建连导致 server 替换连接、丢弃在途命令
  for (let i = 0; i < 6; i++) {
    const url = i % 2 === 0 ? session.serverUrl : `${session.serverUrl}/`;
    await session.sw.evaluate(
      async ({ url: u, token: t }) => {
        await chrome.storage.local.set({ serverUrl: u, token: t });
      },
      { url, token },
    );
  }
  await expect.poll(async () => connStateOf(session.sw), { timeout: 15_000 }).toBe('connected');
  const res = await fetch(`${session.serverUrl}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'extract', params: {}, tabId: session.tabId }),
  });
  const env = (await res.json()) as { error?: unknown };
  expect(env.error, `command failed: ${JSON.stringify(env.error)}`).toBeUndefined();
});

test('extract --article 不再误报 INVALID_PARAMS', async ({ session }) => {
  const web = await startTestWeb();
  try {
    const goto = (await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/article` },
      { tabId: session.tabId },
    )) as { tabId?: number };
    await session.page.waitForURL(`${web.url}/article`, { timeout: 20_000 });
    expect(goto.tabId).toBeDefined();

    const res = await runCli(session.serverUrl, ['extract', '--article']);
    expect(res.stderr).not.toContain('INVALID_PARAMS');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Parklet mock article');
    // 应为 Markdown 而非原始 HTML
    expect(res.stdout).not.toContain('<p>');
    expect(res.stdout).toContain('**bold**');
    expect(res.stdout).toContain('[link](https://example.com/docs)');
    // 元数据以 frontmatter 呈现
    expect(res.stdout).toContain('title: Mock Article Title');
    expect(res.stdout).toContain(`url: ${web.url}/article`);
  } finally {
    web.stop();
  }
});

test('extract structured 分页：返回 total 并回显 offset/limit', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/list` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/list`, { timeout: 20_000 });

    const page1 = (await command(
      session.serverUrl,
      'extract',
      { mode: 'structured', selector: '#list', limit: 10 },
      { tabId: session.tabId },
    )) as { data?: { nodes?: unknown[]; total?: number; limit?: number; offset?: number } };
    expect(page1.data?.total).toBe(25);
    expect(page1.data?.nodes?.length).toBe(10);
    expect(page1.data?.limit).toBe(10);

    const page3 = (await command(
      session.serverUrl,
      'extract',
      { mode: 'structured', selector: '#list', offset: 20, limit: 10 },
      { tabId: session.tabId },
    )) as { data?: { nodes?: unknown[]; total?: number; offset?: number } };
    expect(page3.data?.total).toBe(25);
    expect(page3.data?.offset).toBe(20);
    expect(page3.data?.nodes?.length).toBe(5);
  } finally {
    web.stop();
  }
});

test('extract --fields：输出结构化记录（text / @attr / 绝对 URL / null）', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/list` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/list`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'extract',
      {
        selector: '#list li',
        fields: [
          { name: 'href', selector: 'a', attr: 'href' },
          { name: 'text', selector: 'a' },
          { name: 'missing', selector: '.nope' },
        ],
        limit: 2,
      },
      { tabId: session.tabId },
    )) as {
      data?: {
        mode?: string;
        items?: Array<Record<string, string | null>>;
        total?: number;
      };
    };
    expect(res.data?.mode).toBe('fields');
    expect(res.data?.total).toBe(25);
    expect(res.data?.items).toEqual([
      { href: `${web.url}/item/0`, text: 'Item 0', missing: null },
      { href: `${web.url}/item/1`, text: 'Item 1', missing: null },
    ]);

    const cli = await runCli(session.serverUrl, [
      '--tab',
      String(session.tabId),
      'extract',
      '--selector',
      '#list li',
      '--fields',
      'href=a@href,text=a',
      '--limit',
      '1',
      '--json',
    ]);
    expect(cli.code).toBe(0);
    const parsed = JSON.parse(cli.stdout.trim()) as {
      data?: { items?: Array<Record<string, string | null>> };
    };
    expect(parsed.data?.items).toEqual([{ href: `${web.url}/item/0`, text: 'Item 0' }]);
  } finally {
    web.stop();
  }
});

test('wait：等待元素数量稳定 / 内容就绪', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/spa?n=10&delay=300` },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/spa?n=10&delay=300`, { timeout: 20_000 });
    const wait = (await command(
      session.serverUrl,
      'wait',
      { selector: 'article', count: 10, stableMs: 300 },
      { tabId: session.tabId },
    )) as { data?: { matched?: number; waitedMs?: number; stable?: boolean } };
    expect(wait.data?.matched).toBe(10);
    expect(wait.data?.stable).toBe(true);

    const content = (await command(
      session.serverUrl,
      'wait',
      { condition: 'content', stableMs: 200 },
      { tabId: session.tabId },
    )) as { data?: { stable?: boolean; waitedMs?: number } };
    expect(content.data?.stable).toBe(true);
  } finally {
    web.stop();
  }
});

test('collect --repeat：固定轮次采集虚拟列表并去重', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/feed?n=60` },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/feed?n=60`, { timeout: 20_000 });
    await expect
      .poll(async () => session.page.$$eval('[data-testid="tweet"]', (els) => els.length))
      .toBeGreaterThan(0);

    const res = await runCli(session.serverUrl, [
      '--tab',
      String(session.tabId),
      'collect',
      "article[data-testid='tweet']",
      '--fields',
      'id=article@data-id,author=.author,datetime=time@datetime,text=.text',
      '--repeat',
      '3',
      '--scroll-by',
      '500',
      '--json',
    ]);
    expect(res.code).toBe(0);
    const report = JSON.parse(res.stdout.trim()) as {
      total?: number;
      scrolls?: number;
      duplicates?: number;
      zeroNewSteps?: number;
      stoppedReason?: string;
      steps?: Array<{ newItems: number; totalItems: number }>;
      observed?: { newest?: string; oldest?: string };
    };
    expect(report.scrolls).toBe(3);
    expect(report.steps).toHaveLength(3);
    expect(report.stoppedReason).toBe('repeat-completed');
    expect(report.total).toBeGreaterThan(10);
    expect(report.duplicates).toBeGreaterThan(0);
    expect(report.zeroNewSteps).toBe(0);
    expect(report.observed?.newest).toBeDefined();
    expect(report.observed?.oldest).toBeDefined();
  } finally {
    web.stop();
  }
});

test('collect：重复渲染时按 id 去重', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/feed?n=40&dup=1` },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/feed?n=40&dup=1`, { timeout: 20_000 });
    const res = await runCli(session.serverUrl, [
      '--tab',
      String(session.tabId),
      'collect',
      "article[data-testid='tweet']",
      '--fields',
      'id=article@data-id,text=.text',
      '--repeat',
      '2',
      '--scroll-by',
      '500',
      '--json',
    ]);
    expect(res.code).toBe(0);
    const report = JSON.parse(res.stdout.trim()) as {
      items?: Array<{ id: string | null }>;
      duplicates?: number;
    };
    const ids = (report.items ?? []).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(report.duplicates).toBeGreaterThan(0);
  } finally {
    web.stop();
  }
});

test('press：ArrowDown(keyCode) 驱动页面 JS + Enter 触发表单提交', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/search` },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/search`, { timeout: 20_000 });

    await command(
      session.serverUrl,
      'type',
      { selector: '#q', text: 'hello world' },
      { tabId: session.tabId },
    );
    await expect
      .poll(async () => session.page.$$eval('#suggestions li', (els) => els.length))
      .toBeGreaterThan(0);
    expect(await session.page.evaluate(() => document.activeElement?.id)).toBe('q');

    // 第一条 suggestion 与输入相同，ArrowDown 两次才切到不同建议
    await command(session.serverUrl, 'press', { key: 'ArrowDown' }, { tabId: session.tabId });
    await command(session.serverUrl, 'press', { key: 'ArrowDown' }, { tabId: session.tabId });
    const val = await session.page.$eval('#q', (el) => (el as HTMLTextAreaElement).value);
    expect(val).toContain('python');

    await command(session.serverUrl, 'press', { key: 'Enter' }, { tabId: session.tabId });
    await session.page.waitForURL(/\/results\?/, { timeout: 20_000 });
    expect(await session.page.textContent('#query')).toContain('hello world python');
  } finally {
    web.stop();
  }
});

test('press Enter：普通表单（input + submit）提交', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/form` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/form`, { timeout: 20_000 });
    await command(
      session.serverUrl,
      'fill',
      { selector: '#name', value: 'bob' },
      { tabId: session.tabId },
    );
    await command(
      session.serverUrl,
      'press',
      { selector: '#name', key: 'Enter' },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/submitted?name=bob`, { timeout: 20_000 });
    expect(await session.page.textContent('#greeting')).toBe('hello bob');
  } finally {
    web.stop();
  }
});

test('type：泛化 selector（input / 容器）也能解析并输入', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/form` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/form`, { timeout: 20_000 });
    // 直接命中 input
    await command(
      session.serverUrl,
      'type',
      { selector: 'input', text: 'hi' },
      { tabId: session.tabId },
    );
    expect(await session.page.$eval('#name', (el) => (el as HTMLInputElement).value)).toBe('hi');
    // 命中容器（form），自动解析到其中 input
    await command(
      session.serverUrl,
      'fill',
      { selector: 'form', value: 'bye' },
      { tabId: session.tabId },
    );
    expect(await session.page.$eval('#name', (el) => (el as HTMLInputElement).value)).toBe('bye');
  } finally {
    web.stop();
  }
});

test('screenshot CLI：未指定 --path 时默认落盘并打印路径', async ({ session }) => {
  const dir = mkdtempSync(join(tmpdir(), 'plt-shot-'));
  try {
    const res = await runCli(session.serverUrl, ['screenshot'], { cwd: dir });
    expect(res.code).toBe(0);
    const match = /saved to (.+\.png)/.exec(res.stdout);
    expect(match).not.toBeNull();
    const file = match![1]!;
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('page-info：返回状态/滚动/activeElement/selector 计数', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/query` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/query`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'get-page-info',
      { selector: '.item' },
      { tabId: session.tabId },
    )) as {
      data?: {
        readyState?: string;
        visibilityState?: string;
        selection?: string;
        scroll?: { y: number; scrollHeight: number; clientHeight: number };
        activeElement?: { tag: string };
        selector?: { count: number };
      };
    };
    expect(res.data?.readyState).toBe('complete');
    expect(res.data?.visibilityState).toBe('visible');
    expect(res.data?.selection).toBe('');
    expect(res.data?.scroll?.clientHeight).toBeGreaterThan(0);
    expect(res.data?.activeElement?.tag).toBeDefined();
    expect(res.data?.selector?.count).toBe(2);
  } finally {
    web.stop();
  }
});

test('screenshot --selector：自动激活非 active tab', async ({ session }) => {
  const web = await startTestWeb();
  let otherTabId: number | undefined;
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/query` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/query`, { timeout: 20_000 });
    const created = (await command(session.serverUrl, 'create-tab', {
      url: `${web.url}/tall`,
    })) as { data?: { tab?: { id?: number } } };
    otherTabId = created.data?.tab?.id;
    expect(otherTabId).toBeDefined();
    await new Promise((r) => setTimeout(r, 300));

    const shot = (await command(
      session.serverUrl,
      'screenshot',
      { selector: '#host' },
      { tabId: session.tabId },
    )) as { data?: { data?: string } };
    expect(shot.data?.data).toBeDefined();
    expect(Buffer.from(shot.data!.data!, 'base64').subarray(0, 8).toString('hex')).toBe(
      '89504e470d0a1a0a',
    );
    const tabs = (await command(session.serverUrl, 'list-tabs', {}, {})) as {
      data?: { tabs?: Array<{ id: number; active: boolean }> };
    };
    expect(tabs.data?.tabs?.find((t) => t.id === session.tabId)?.active).toBe(true);
  } finally {
    if (otherTabId !== undefined) {
      await command(session.serverUrl, 'close-tab', { tabId: otherTabId }).catch(() => {});
    }
    web.stop();
  }
});

test('截图返回 base64 PNG 数据', async ({ session }) => {
  const shot = (await command(session.serverUrl, 'screenshot', {}, { tabId: session.tabId })) as {
    data?: { data?: string };
  };
  expect(shot.data?.data).toBeDefined();
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  expect(Buffer.from(shot.data!.data!, 'base64').subarray(0, 8).toString('hex')).toBe(
    '89504e470d0a1a0a',
  );
});

test('click-text：正文同名字符串不抢按钮', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/mixed-text` },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/mixed-text`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'click-text',
      { text: 'Following' },
      { tabId: session.tabId },
    )) as { data?: { element?: { tag?: string; attrs?: Record<string, string> } } };
    expect(res.data?.element?.tag).toBe('button');
    expect(res.data?.element?.attrs?.id).toBe('follow');
    expect(await session.page.textContent('#result')).toBe('clicked');
  } finally {
    web.stop();
  }
});

test('fill + 点击提交：表单真实提交（受控输入事件链路）', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/form` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/form`, { timeout: 20_000 });

    await command(
      session.serverUrl,
      'fill',
      { selector: '#name', value: 'alice' },
      { tabId: session.tabId },
    );
    const val = await session.page.$eval('#name', (el) => (el as HTMLInputElement).value);
    expect(val).toBe('alice');

    await command(
      session.serverUrl,
      'click-text',
      { text: 'Submit form' },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/submitted?name=alice`, { timeout: 20_000 });
    const greeting = await session.page.textContent('#greeting');
    expect(greeting).toBe('hello alice');
  } finally {
    web.stop();
  }
});

test('页面上下文 fetch：本地 API 请求返回真实响应', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'fetch',
      { url: `${web.url}/api/echo?x=1&y=two` },
      { tabId: session.tabId },
    )) as { data?: { status?: number; body?: string } };
    expect(res.data?.status).toBe(200);
    const parsed = JSON.parse(res.data?.body ?? '{}') as {
      ok?: boolean;
      query?: Record<string, string>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.query?.x).toBe('1');
    expect(parsed.query?.y).toBe('two');
  } finally {
    web.stop();
  }
});

test('scroll --by：返回真实 delta 且 scrollY 同步变化', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/tall` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/tall`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'scroll',
      { by: 850 },
      { tabId: session.tabId },
    )) as { data?: { before?: { y: number }; after?: { y: number }; delta?: { y: number } } };
    expect(res.data?.delta?.y).toBeGreaterThanOrEqual(849);
    expect(res.data?.delta?.y).toBeLessThanOrEqual(851);
    const info = (await command(
      session.serverUrl,
      'get-page-info',
      {},
      { tabId: session.tabId },
    )) as { data?: { scrollY?: number } };
    expect(info.data?.scrollY).toBe(res.data?.after?.y);
  } finally {
    web.stop();
  }
});

test('scroll --to：到底后再次滚动报 NO_EFFECT', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/tall` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/tall`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'scroll',
      { to: 'bottom' },
      { tabId: session.tabId },
    )) as { data?: { atBottom?: boolean } };
    expect(res.data?.atBottom).toBe(true);
    await expect(
      command(session.serverUrl, 'scroll', { to: 'bottom' }, { tabId: session.tabId }),
    ).rejects.toThrow(/NO_EFFECT/);
    const allowed = (await command(
      session.serverUrl,
      'scroll',
      { to: 'bottom', allowNoop: true },
      { tabId: session.tabId },
    )) as { data?: { delta?: { y: number } } };
    expect(allowed.data?.delta?.y).toBe(0);
  } finally {
    web.stop();
  }
});

test('extract --mode links：分组、分页与作用域', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/list` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/list`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'extract',
      { mode: 'links', limit: 5 },
      { tabId: session.tabId },
    )) as {
      data?: {
        mode?: string;
        links?: Array<{ href: string; texts: string[]; count: number }>;
        total?: number;
        limit?: number;
      };
    };
    expect(res.data?.mode).toBe('links');
    expect(res.data?.total).toBe(25);
    expect(res.data?.links).toHaveLength(5);
    expect(res.data?.limit).toBe(5);
    expect(res.data?.links?.[0]?.href).toMatch(/\/item\/0$/);
    expect(res.data?.links?.[0]?.texts).toContain('Item 0');

    await command(session.serverUrl, 'goto', { url: `${web.url}/scope` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/scope`, { timeout: 20_000 });
    const scoped = (await command(
      session.serverUrl,
      'extract',
      { mode: 'links', selector: "div[role='tablist']" },
      { tabId: session.tabId },
    )) as { data?: { links?: Array<{ href: string }> } };
    expect(scoped.data?.links?.map((l) => l.href)).toEqual([
      `${web.url}/tab-1`,
      `${web.url}/tab-2`,
    ]);

    const cli = await runCli(session.serverUrl, [
      '--tab',
      String(session.tabId),
      'extract',
      '--mode',
      'links',
      '--within',
      "div[role='tablist']",
      '--limit',
      '1',
      '--json',
    ]);
    expect(cli.code, cli.stderr).toBe(0);
    const parsed = JSON.parse(cli.stdout.trim()) as { data?: { links?: unknown[] } };
    expect(parsed.data?.links).toHaveLength(1);
  } finally {
    web.stop();
  }
});

test('extract --mode forms：labels / password 脱敏 / 勾选态 / 分组', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/form-rich` },
      {
        tabId: session.tabId,
      },
    );
    await session.page.waitForURL(`${web.url}/form-rich`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'extract',
      { mode: 'forms' },
      { tabId: session.tabId },
    )) as {
      data?: {
        mode?: string;
        forms?: Array<{
          action?: string;
          method?: string;
          fields: Array<Record<string, unknown>>;
        }>;
        total?: number;
      };
    };
    expect(res.data?.mode).toBe('forms');
    expect(res.data?.total).toBeGreaterThanOrEqual(6);
    const form = res.data?.forms?.[0];
    expect(form?.action).toBe('/submitted');
    expect(form?.method).toBe('POST');
    const fields = form?.fields ?? [];
    expect(fields.find((f) => f.name === 'user')?.labels).toContain('Username');
    expect(fields.find((f) => f.name === 'pw')?.value).toBe('********');
    expect(fields.find((f) => f.name === 'remember')?.checked).toBe(true);
    expect(fields.find((f) => f.name === 'country')?.selected).toContain('us');
  } finally {
    web.stop();
  }
});

test('selection：按 selector 选中并返回文本', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/article` },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/article`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'selection',
      { selector: '#main h1' },
      {
        tabId: session.tabId,
      },
    )) as { data?: { text?: string } };
    expect(res.data?.text).toBe('Mock Article Title');
  } finally {
    web.stop();
  }
});

test('eval：执行脚本返回序列化结果，不可序列化报 NOT_SERIALIZABLE', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(
      session.serverUrl,
      'goto',
      { url: `${web.url}/article` },
      { tabId: session.tabId },
    );
    await session.page.waitForURL(`${web.url}/article`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'eval',
      { script: 'const n = document.querySelectorAll("h1").length;\nreturn n;' },
      { tabId: session.tabId },
    )) as { data?: { value?: number } };
    expect(res.data?.value).toBe(1);
    await expect(
      command(session.serverUrl, 'eval', { script: 'return 1n;' }, { tabId: session.tabId }),
    ).rejects.toThrow(/NOT_SERIALIZABLE/);
  } finally {
    web.stop();
  }
});

test('scroll --focus：激活目标 tab 后再滚动', async ({ session }) => {
  const web = await startTestWeb();
  let otherTabId: number | undefined;
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/tall` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/tall`, { timeout: 20_000 });

    const created = (await command(session.serverUrl, 'create-tab', {
      url: `${web.url}/tall`,
    })) as { data?: { tab?: { id?: number } } };
    otherTabId = created.data?.tab?.id;
    expect(otherTabId).toBeDefined();
    await command(session.serverUrl, 'activate-tab', { tabId: otherTabId! });
    await new Promise((r) => setTimeout(r, 300));

    const focused = (await command(
      session.serverUrl,
      'scroll',
      { by: 200, focus: true },
      { tabId: session.tabId },
    )) as { data?: { delta?: { y: number } } };
    expect(focused.data?.delta?.y).toBeGreaterThan(0);

    const tabs = (await command(session.serverUrl, 'list-tabs', {}, {})) as {
      data?: { tabs?: Array<{ id: number; active: boolean }> };
    };
    expect(tabs.data?.tabs?.find((t) => t.id === session.tabId)?.active).toBe(true);
  } finally {
    if (otherTabId !== undefined) {
      await command(session.serverUrl, 'close-tab', { tabId: otherTabId }).catch(() => {});
    }
    web.stop();
  }
});

test('scroll --selector：滚动内部容器触发懒加载', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/lazy` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/lazy`, { timeout: 20_000 });
    const before = (await command(
      session.serverUrl,
      'extract',
      { mode: 'structured', selector: '.row', depth: 0 },
      { tabId: session.tabId },
    )) as { data?: { total?: number } };
    expect(before.data?.total).toBe(10);
    await command(
      session.serverUrl,
      'scroll',
      { selector: '#list', by: 400 },
      { tabId: session.tabId },
    );
    const after = (await command(
      session.serverUrl,
      'extract',
      { mode: 'structured', selector: '.row', depth: 0 },
      { tabId: session.tabId },
    )) as { data?: { total?: number } };
    expect(after.data?.total).toBeGreaterThan(10);
  } finally {
    web.stop();
  }
});

test('dom-query：按 selector 返回匹配数与概要', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/query` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/query`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'dom-query',
      { selector: '.item' },
      { tabId: session.tabId },
    )) as { data?: { total?: number; matches?: Array<{ text?: string }> } };
    expect(res.data?.total).toBe(2);
    expect(res.data?.matches?.map((m) => m.text)).toEqual(['alpha', 'beta']);
  } finally {
    web.stop();
  }
});

test('extract --exclude：剔除匹配元素', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/query` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/query`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'extract',
      { mode: 'text', selector: '#host', exclude: '.noise' },
      { tabId: session.tabId },
    )) as { data?: { texts?: string[] } };
    expect(res.data?.texts).toEqual(['alpha', 'beta']);
  } finally {
    web.stop();
  }
});

test('plt run：一次进程执行多条命令（JSON lines）', async ({ session }) => {
  const web = await startTestWeb();
  const dir = mkdtempSync(join(tmpdir(), 'pl-run-'));
  const file = join(dir, 'cmds.jsonl');
  try {
    writeFileSync(
      file,
      [
        JSON.stringify({
          method: 'goto',
          params: { url: '${base}/${suffix}' },
          tabId: session.tabId,
        }),
        JSON.stringify({
          method: 'extract',
          params: { mode: 'structured', selector: '#list', depth: 0 },
          tabId: session.tabId,
          as: 'page',
        }),
        JSON.stringify({
          method: 'wait',
          params: { ms: '${page.total}' },
          tabId: session.tabId,
        }),
      ].join('\n'),
    );
    const res = await runCli(session.serverUrl, [
      'run',
      file,
      '--var',
      `base=${web.url}`,
      '--var',
      'suffix=list',
      '--json',
    ]);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('"total"');
    expect(res.stdout).toContain('"waitedMs"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    web.stop();
  }
});

test('extract --mode html：返回 outerHTML（可按 class 区分）', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/query` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/query`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'extract',
      { mode: 'html', selector: '#host' },
      { tabId: session.tabId },
    )) as { data?: { items?: string[] } };
    expect(res.data?.items?.[0]).toContain('class="item"');
    expect(res.data?.items?.[0]).toContain('alpha');
  } finally {
    web.stop();
  }
});

test('scroll-to：把元素滚入视口', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/tall` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/tall`, { timeout: 20_000 });
    const res = (await command(
      session.serverUrl,
      'scroll-to',
      { selector: 'footer' },
      { tabId: session.tabId },
    )) as { data?: { delta?: { y: number } } };
    expect(res.data?.delta?.y).toBeGreaterThan(0);
    const info = (await command(
      session.serverUrl,
      'get-page-info',
      {},
      { tabId: session.tabId },
    )) as { data?: { scrollY?: number } };
    expect(info.data?.scrollY).toBeGreaterThan(100);
  } finally {
    web.stop();
  }
});

test('--json 输出可被严格 JSON.parse', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/query` }, { tabId: session.tabId });
    const res = await runCli(session.serverUrl, [
      '--tab',
      String(session.tabId),
      'extract',
      '--selector',
      '#host',
      '--json',
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim()) as { tabId?: number; data?: { texts?: string[] } };
    expect(typeof parsed.tabId).toBe('number');
    expect(Array.isArray(parsed.data?.texts)).toBe(true);
    expect(res.stderr).toContain('📍');

    const quiet = await runCli(session.serverUrl, [
      '--tab',
      String(session.tabId),
      '--quiet',
      'extract',
      '--selector',
      '#host',
      '--json',
    ]);
    expect(quiet.code).toBe(0);
    expect(quiet.stderr).toBe('');
    expect(() => JSON.parse(quiet.stdout.trim())).not.toThrow();
  } finally {
    web.stop();
  }
});
