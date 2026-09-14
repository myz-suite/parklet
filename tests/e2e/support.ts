import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';

export const EXTENSION_PATH = join(process.cwd(), 'packages/extension/dist');
const E2E_PORT = 18787;

export interface RunningServer {
  url: string;
  token: string;
  stop: () => void;
}

/** 启动 parkinglot-server（随机/固定端口 + 临时 state dir），返回 base url 与配对 token。 */
export async function startServer(): Promise<RunningServer> {
  const stateDir = mkdtempSync(join(tmpdir(), 'plt-e2e-'));
  const proc = spawn(process.execPath, [join(process.cwd(), 'packages/server/dist/index.js')], {
    env: {
      ...process.env,
      PARKINGLOT_PORT: String(E2E_PORT),
      PARKINGLOT_STATE_DIR: stateDir,
    },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${E2E_PORT}`;
  // 等待 /api/status 可用
  await waitFor(
    async () => {
      try {
        const res = await fetch(`${url}/api/status`);
        return res.ok;
      } catch {
        return false;
      }
    },
    10_000,
    'server start',
  );
  const token = readFileSync(join(stateDir, 'token'), 'utf8').trim();
  return {
    url,
    token,
    stop: () => {
      proc.kill('SIGTERM');
      try {
        rmSync(stateDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/** Playwright 扩展会话：持久上下文 + MV3 service worker。 */
export async function launchExtensionContext(
  serverUrl: string,
  token: string,
): Promise<{
  context: BrowserContext;
  sw: Worker;
  profileDir: string;
}> {
  const profileDir = mkdtempSync(join(tmpdir(), 'plt-profile-'));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });

  // 自动配对：写入 storage 触发 background 的 storage.onChanged → connect()
  await sw.evaluate(
    async ({ serverUrl, token }) => {
      await chrome.storage.local.set({ serverUrl, token });
    },
    { serverUrl, token },
  );

  // 等 server 看到扩展连接
  await waitFor(
    async () => {
      const res = await fetch(`${serverUrl}/api/status`);
      const status = (await res.json()) as { extensionConnected?: boolean };
      return status.extensionConnected === true;
    },
    12_000,
    'extension pairing',
  );
  return { context, sw, profileDir };
}

/** 通过 server HTTP 通道发一条命令，返回 result；EXTENSION_OFFLINE 等瞬时错误重试。
 * 可选 opts.tabId 显式指定目标（绕过"最近激活 tab"竞态）。 */
export async function command(
  serverUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: { tabId?: number } = {},
): Promise<Record<string, unknown>> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${serverUrl}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params, tabId: opts.tabId }),
    });
    const env = (await res.json()) as {
      result?: Record<string, unknown>;
      error?: { code?: string; message?: string };
    };
    if (!env.error) return env.result!;
    lastError = new Error(`command ${method} failed: ${env.error.code}: ${env.error.message}`);
    // SW 回收/重连竞态：等扩展真正回到 online 再重试
    if (env.error.code === 'EXTENSION_OFFLINE') {
      await waitForExtensionOnline(serverUrl, 12_000);
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

/** 轮询 /api/status 直到扩展重连（SW 回收后 alarms 会在 ~30s 内唤醒重连）。 */
export async function waitForExtensionOnline(serverUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${serverUrl}/api/status`);
      const status = (await res.json()) as { extensionConnected?: boolean };
      if (status.extensionConnected === true) return;
    } catch {
      /* server 未就绪则继续等 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** 本地测试页：承载 /、/target-page、/form、/api/echo、/tall，供 E2E 稳定交互。 */
export async function startTestWeb(): Promise<{ url: string; stop: () => void }> {
  const server = createServer((req, res) => {
    const send = (body: string, type = 'text/html; charset=utf-8') => {
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    };
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/target-page') {
      send('<html><body><h1>target-page</h1></body></html>');
      return;
    }
    if (url.pathname === '/form') {
      send(
        '<html><body><h1>login-form</h1>' +
          '<form method="get" action="/submitted">' +
          '<input id="name" name="name" value="">' +
          '<button id="submit" type="submit">Submit form</button>' +
          '</form></body></html>',
      );
      return;
    }
    if (url.pathname === '/submitted') {
      const name = url.searchParams.get('name') ?? '';
      send(`<html><body><h1>submitted</h1><p id="greeting">hello ${name}</p></body></html>`);
      return;
    }
    if (url.pathname === '/api/echo') {
      send(
        JSON.stringify({
          ok: true,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
        }),
        'application/json',
      );
      return;
    }
    if (url.pathname === '/tall') {
      // 足够高以便 scroll
      send(
        `<html><body><h1>tall-page</h1>${'<p style="height:40px">line</p>'.repeat(80)}<footer>the-end</footer></body></html>`,
      );
      return;
    }
    send('<html><body><h1>test home</h1><a href="/target-page">Learn more</a></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test web: no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => server.close(),
  };
}

export async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
}
