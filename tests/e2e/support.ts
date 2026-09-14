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

/** 本地测试页：承载 /、/target-page、/form、/api/echo、/tall、/search、/results、/list、/article。 */
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
    // 模拟搜索引擎：输入框 + 联想（keydown ArrowDown 填充）+ 原生表单提交（Enter）
    if (url.pathname === '/search') {
      send(`<!doctype html><html><body>
<h1>Mock Search</h1>
<form id="sf" method="get" action="/results">
  <textarea id="q" name="q" rows="1"></textarea>
  <button id="go" type="submit">Search</button>
</form>
<ul id="suggestions"></ul>
<script>
  const q = document.getElementById('q');
  const ul = document.getElementById('suggestions');
  const DATA = ['hello world', 'hello world python', 'hello world java', 'hello world c++'];
  let active = -1;
  function matches() { return DATA.filter((d) => d.includes(q.value.toLowerCase())); }
  function render() {
    ul.replaceChildren();
    if (!q.value) { active = -1; return; }
    for (const m of matches()) {
      const li = document.createElement('li');
      li.textContent = m;
      li.dataset.value = m;
      ul.appendChild(li);
    }
  }
  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    const list = matches();
    if (e.keyCode === 40 && list.length > 0) {
      active = Math.min(active + 1, list.length - 1);
      q.value = list[active];
      render();
      e.preventDefault();
    } else if (e.keyCode === 38 && list.length > 0) {
      active = Math.max(active - 1, 0);
      q.value = list[active];
      render();
      e.preventDefault();
    }
  });
</script>
</body></html>`);
      return;
    }
    if (url.pathname === '/results') {
      const query = url.searchParams.get('q') ?? '';
      send(`<!doctype html><html><body>
<h1>Mock Results</h1>
<p id="query">Results for: ${query}</p>
<ol id="results">
  <li><a href="/target-page?r=1">Result one for ${query}</a></li>
  <li><a href="/target-page?r=2">Result two for ${query}</a></li>
</ol>
</body></html>`);
      return;
    }
    // 列表页：25 个 li，用于 offset/limit/total 分页验证
    if (url.pathname === '/list') {
      const items = Array.from(
        { length: 25 },
        (_, i) => `<li><a href="/item/${i}" title="Item ${i}">Item ${i}</a></li>`,
      ).join('');
      send(
        `<!doctype html><html><body><article><ul id="list">${items}</ul></article></body></html>`,
      );
      return;
    }
    // 文章页：供 defuddle article 提取（含粗体/链接/列表，便于断言 markdown）
    if (url.pathname === '/article') {
      const para =
        '<p>ParkingLot mock article body sentence explains how agents drive a real browser. </p>';
      send(
        `<!doctype html><html><head><title>Mock Article</title>` +
          '<meta property="og:title" content="Mock Article Title">' +
          '<meta name="description" content="A mock article for extraction tests."></head><body>' +
          '<article id="main"><h1>Mock Article Title</h1>' +
          para.repeat(8) +
          '<p>A <strong>bold</strong> word and a <a href="https://example.com/docs">link</a>.</p>' +
          '<ul><li>first point</li><li>second point</li></ul>' +
          para.repeat(4) +
          '</article></body></html>',
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

/** 运行编译后的 `plt` CLI（dist/cli.js），返回退出码与输出。 */
export async function runCli(
  serverUrl: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [join(process.cwd(), 'packages/server/dist/cli.js'), '--server', serverUrl, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
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
