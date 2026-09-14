import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
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
  /** 扩展视角的目标 chrome tabId（create-tab 返回，命令显式携带） */
  tabId: number;
}

// 扩展会话 fixture：每次 launch 独立 profile 并自动配对、create-tab 开 example.com，
// 用例结束自动关闭 context 并清理 profile（避免 chromium 进程泄漏导致后续用例不稳定）。
export const test = base.extend<{ session: Session }>({
  session: [
    async ({}, use) => {
      const server = await startServer();
      let session: Session;
      try {
        const { context, sw, profileDir } = await launchExtensionContext(server.url, server.token);
        try {
          const prevPages = context.pages().length;
          const created = (await command(server.url, 'create-tab', {
            url: 'https://example.com',
          })) as { data?: { tab?: { id?: number } } };
          const tabId = created.data?.tab?.id;
          if (typeof tabId !== 'number') throw new Error('create-tab did not return a tab id');

          const page =
            context.pages().length > prevPages
              ? context.pages()[context.pages().length - 1]!
              : await context.waitForEvent('page', { timeout: 10_000 });
          await page.waitForLoadState('domcontentloaded');
          session = { serverUrl: server.url, page, context, sw, server, tabId };
        } finally {
          // 若 fixture 内初始化失败也要关浏览器
          if (!session) await context.close().catch(() => {});
        }
        await use(session);
        await context.close().catch(() => {});
        rmSync(profileDir, { recursive: true, force: true });
      } finally {
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

test('goto 驱动真实页面并返回 context 快照', async ({ session }) => {
  const goto = (await command(
    session.serverUrl,
    'goto',
    { url: 'https://www.iana.org/help/example-domains' },
    { tabId: session.tabId },
  )) as { context?: { url?: string; navId?: number } };

  expect(goto.context?.url).toContain('iana.org');
  expect(goto.context?.navId).toBeGreaterThanOrEqual(1);
  await session.page.waitForURL('https://www.iana.org/**', { timeout: 20_000 });
  expect(session.page.url()).toContain('iana.org');
});

test('session 连续性：后续命令复用同一会话并感知导航', async ({ session }) => {
  // 首次显式 goto 建立 session 并绑定 tab
  const goto = (await command(
    session.serverUrl,
    'goto',
    { url: 'https://example.com' },
    { tabId: session.tabId },
  )) as { sessionId?: string; context?: { url?: string } };
  await session.page.waitForURL('https://example.com/**', { timeout: 20_000 });
  expect(goto.sessionId).toMatch(/^pl-/);

  // 后续命令不带 tabId：走默认 session（连续性），context 应一致
  const extract = (await command(session.serverUrl, 'extract', {})) as {
    sessionId?: string;
    context?: { url?: string };
    data?: { snapshot?: { visibleText?: string } };
  };
  expect(extract.sessionId).toBe(goto.sessionId);
  expect(extract.context?.url).toContain('example.com');
  expect(extract.data?.snapshot?.visibleText).toContain('Example Domain');
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
    )) as { sessionId?: string };
    await session.page.waitForURL(`${web.url}/article`, { timeout: 20_000 });
    expect(goto.sessionId).toBeDefined();

    const res = await runCli(session.serverUrl, ['extract', '--article']);
    expect(res.stderr).not.toContain('INVALID_PARAMS');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('ParkingLot mock article');
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

test('scroll：滚动后 scrollY 真实变化', async ({ session }) => {
  const web = await startTestWeb();
  try {
    await command(session.serverUrl, 'goto', { url: `${web.url}/tall` }, { tabId: session.tabId });
    await session.page.waitForURL(`${web.url}/tall`, { timeout: 20_000 });
    await command(session.serverUrl, 'scroll', { direction: 'bottom' }, { tabId: session.tabId });
    await new Promise((r) => setTimeout(r, 900)); // smooth 滚动落定
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
