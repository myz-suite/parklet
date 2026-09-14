import { rmSync } from 'node:fs';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { command, launchExtensionContext, startServer, startTestWeb } from './support';

export interface Session {
  serverUrl: string;
  page: Page;
  context: BrowserContext;
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
        const { context, profileDir } = await launchExtensionContext(server.url, server.token);
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
          session = { serverUrl: server.url, page, context, tabId };
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

test('SW 保活：空闲超过回收阈值后仍在线（alarms 唤醒重连）', async ({ session }) => {
  test.setTimeout(150_000);
  const ping1 = (await command(session.serverUrl, 'ping', {})) as {
    data?: { extensionConnected?: boolean };
  };
  expect(ping1.data?.extensionConnected).toBe(true);
  // 超过 MV3 ~30s 回收阈值 + alarms 30s 周期：SW 被回收后由 alarms 唤醒重连
  await new Promise((r) => setTimeout(r, 75_000));
  const ping2 = (await command(session.serverUrl, 'ping', {})) as {
    data?: { extensionConnected?: boolean };
  };
  expect(ping2.data?.extensionConnected).toBe(true);
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
