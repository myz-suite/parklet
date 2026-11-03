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

/** 启动 parklet-server（固定端口 + 临时 state dir），返回 base url 与配对 token。 */
export async function startServer(opts: { enableEval?: boolean } = {}): Promise<RunningServer> {
  const stateDir = mkdtempSync(join(tmpdir(), 'plt-e2e-'));
  const proc = spawn(process.execPath, [join(process.cwd(), 'packages/server/dist/index.js')], {
    env: {
      ...process.env,
      PARKLET_PORT: String(E2E_PORT),
      PARKLET_STATE_DIR: stateDir,
      ...(opts.enableEval ? { PARKLET_ENABLE_EVAL: '1' } : {}),
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
  opts: { autopair?: boolean } = {},
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

  if (opts.autopair === false) {
    return { context, sw, profileDir };
  }

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
    // iframe 夹具：/frame-host?cross=<另一个 origin> 同时挂同源与跨域 frame。
    if (url.pathname === '/frame-host') {
      const crossBase = url.searchParams.get('cross') ?? '';
      const crossSrc =
        crossBase.length > 0 ? `${crossBase}/frame-child?name=cross` : '/frame-child?name=cross';
      send(
        '<!doctype html><html><body><h1>frame-host</h1>' +
          '<iframe id="same" src="/frame-child?name=same"></iframe>' +
          `<iframe id="cross" src="${crossSrc}"></iframe>` +
          '</body></html>',
      );
      return;
    }
    if (url.pathname === '/frame-child') {
      const name = url.searchParams.get('name') ?? 'child';
      send(`<!doctype html><html><body>
<h1 id="frame-title">frame child ${name}</h1>
<button id="frame-btn">Frame Button</button>
<input id="frame-input" placeholder="frame input">
<a href="/target-page">Frame Link</a>
</body></html>`);
      return;
    }
    // Shadow DOM 夹具：open root（可操作）与 closed root（应不可见）。
    if (url.pathname === '/shadow') {
      send(`<!doctype html><html><body>
<h1>shadow page</h1>
<my-card></my-card>
<closed-card></closed-card>
<script>
class MyCard extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<div class="card"><h2>Shadow Title</h2><p class="body">Shadow body text</p><button id="shadow-btn">Shadow Action</button><input id="shadow-input" placeholder="shadow input"><a href="/target-page">Shadow Link</a></div>';
  }
}
customElements.define('my-card', MyCard);
class ClosedCard extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed' });
    root.innerHTML = '<p>Closed body text</p>';
  }
}
customElements.define('closed-card', ClosedCard);
</script>
</body></html>`);
      return;
    }
    // 原生对话框夹具：用于验证“停滞提示 + 用户处理”，不做自动应答。
    if (url.pathname === '/dialogs') {
      send(`<!doctype html><html><body>
<h1>dialogs</h1>
<button id="alert-btn">Alert</button>
<button id="confirm-btn">Confirm</button>
<button id="prompt-btn">Prompt</button>
<p id="result">idle</p>
<script>
document.getElementById('alert-btn').addEventListener('click', function () {
  alert('hello alert');
});
document.getElementById('confirm-btn').addEventListener('click', function () {
  document.getElementById('result').textContent = 'confirm:' + confirm('continue?');
});
document.getElementById('prompt-btn').addEventListener('click', function () {
  document.getElementById('result').textContent = 'prompt:' + String(prompt('name?', 'default'));
});
</script>
</body></html>`);
      return;
    }
    // 文件上传夹具：把选中的文件内容回显到 #out。
    if (url.pathname === '/upload') {
      send(`<!doctype html><html><body>
<h1>upload</h1>
<input id="file" type="file" multiple>
<pre id="out"></pre>
<script>
document.getElementById('file').addEventListener('change', async function () {
  const out = document.getElementById('out');
  const files = Array.from(this.files || []);
  const texts = [];
  for (const f of files) texts.push(f.name + ':' + await f.text());
  out.textContent = texts.join('|');
});
</script>
</body></html>`);
      return;
    }
    // 下载夹具：浏览器下载事件与 wait --condition download 用。
    if (url.pathname === '/download') {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="fixture.txt"',
      });
      res.end('download fixture\n');
      return;
    }
    // 网络夹具：点击后发起 500ms 延迟请求，供 networkidle / requests 测试。
    if (url.pathname === '/network') {
      send(`<!doctype html><html><body>
<h1>network</h1>
<button id="slow">Slow request</button>
<p id="status">idle</p>
<script>
document.getElementById('slow').addEventListener('click', async function () {
  const status = document.getElementById('status');
  status.textContent = 'loading';
  const res = await fetch('/api/slow?ms=500');
  status.textContent = 'done:' + await res.text();
});
</script>
</body></html>`);
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
    // 富表单：labels / password / checkbox / select / textarea / submit（links & forms 测试）
    if (url.pathname === '/form-rich') {
      send(`<!doctype html><html><body>
<h1>rich-form</h1>
<form action="/submitted" method="post">
  <label for="user">Username</label>
  <input id="user" name="user" value="">
  <label for="pw">Password</label>
  <input id="pw" name="pw" type="password" value="secret">
  <input type="checkbox" name="remember" checked>
  <select name="country"><option value="jp">Japan</option><option value="us" selected>USA</option></select>
  <textarea name="bio"></textarea>
  <button type="submit">Sign in</button>
</form>
</body></html>`);
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
    if (url.pathname === '/api/slow') {
      const raw = Number(url.searchParams.get('ms') ?? '500');
      const ms = Number.isFinite(raw) ? Math.max(0, raw) : 500;
      setTimeout(() => send('ok', 'text/plain; charset=utf-8'), ms);
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
    // 懒加载列表：滚动内部容器时追加行（scroll --selector 测试）
    if (url.pathname === '/lazy') {
      send(`<!doctype html><html><body>
<h1>lazy</h1>
<div id="list" style="height:200px;overflow:auto;border:1px solid #ccc"><div id="rows"></div></div>
<script>
  const rows = document.getElementById('rows');
  let n = 0;
  function add(k) {
    for (let i = 0; i < k; i += 1) {
      const d = document.createElement('div');
      d.className = 'row';
      d.style.height = '40px';
      d.textContent = 'row ' + (n++);
      rows.appendChild(d);
    }
  }
  add(10);
  document.getElementById('list').addEventListener('scroll', () => add(10));
</script>
</body></html>`);
      return;
    }
    // SPA：延迟渲染 N 个 article；用于 wait --count/--stable/--condition content。
    if (url.pathname === '/spa') {
      send(`<!doctype html><html><body>
<h1>spa</h1>
<div id="app">loading</div>
<script>
  const params = new URLSearchParams(location.search);
  const n = Number(params.get('n') || '10');
  const delay = Number(params.get('delay') || '300');
  setTimeout(function () {
    const app = document.getElementById('app');
    app.innerHTML = Array.from({ length: n }, function (_, i) {
      return '<article data-id="' + i + '">item ' + i + '</article>';
    }).join('');
  }, delay);
</script>
</body></html>`);
      return;
    }
    // 虚拟列表：只渲染视口附近的 ~10 条；用于 collect / repeat / 去重。
    if (url.pathname === '/feed') {
      send(`<!doctype html><html><body>
<h1>feed</h1>
<div id="feed" style="position:relative"></div>
<script>
  const params = new URLSearchParams(location.search);
  const N = Number(params.get('n') || '200');
  const H = 100;
  const DUP = params.get('dup') === '1';
  const feed = document.getElementById('feed');
  feed.style.height = (N * H) + 'px';
  const win = document.createElement('div');
  win.id = 'window';
  win.style.position = 'absolute';
  win.style.left = '0';
  win.style.right = '0';
  feed.appendChild(win);
  function render() {
    const start = Math.max(0, Math.floor(window.scrollY / H) - 1);
    const end = Math.min(N, start + 10);
    win.style.top = (start * H) + 'px';
    win.replaceChildren();
    for (let i = start; i < end; i += 1) {
      const a = document.createElement('article');
      a.dataset.testid = 'tweet';
      a.dataset.id = String(i);
      const d = new Date(Date.now() - i * 60000).toISOString();
      a.innerHTML = '<span class="author">user' + (i % 3) + '</span>' +
        '<time datetime="' + d + '">' + i + 'm</time>' +
        '<p class="text">tweet text ' + i + '</p>';
      win.appendChild(a);
      if (DUP) win.appendChild(a.cloneNode(true));
    }
  }
  window.addEventListener('scroll', render);
  render();
</script>
</body></html>`);
      return;
    }
    // links/forms 作用域：tablist 内链接与推文图片链接分离。
    if (url.pathname === '/scope') {
      send(`<!doctype html><html><body>
<div role="tablist">
  <a href="/tab-1">Tab One</a>
  <a href="/tab-2">Tab Two</a>
</div>
<article>
  <a href="/photo-1">photo</a>
</article>
</body></html>`);
      return;
    }
    // click-text：正文同名字符串 + 唯一按钮；用于可点击性判定回归。
    if (url.pathname === '/mixed-text') {
      send(`<!doctype html><html><body>
<h1>mixed text</h1>
<button id="follow">Following</button>
<p>Following this thread is useful</p>
<p>Following</p>
<div id="result">idle</div>
<script>
document.getElementById('follow').addEventListener('click', function () {
  document.getElementById('result').textContent = 'clicked';
});
</script>
</body></html>`);
      return;
    }
    // 查询/去噪：匹配元素 + 噪声按钮（dom-query / exclude 测试）
    if (url.pathname === '/query') {
      send(`<!doctype html><html><body>
<div id="host">
  <div class="item">alpha</div>
  <div class="item">beta</div>
  <button class="noise">Copy</button>
</div>
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
        '<p>Parklet mock article body sentence explains how agents drive a real browser. </p>';
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
  opts: { cwd?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [join(process.cwd(), 'packages/server/dist/cli.js'), '--server', serverUrl, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], ...(opts.cwd ? { cwd: opts.cwd } : {}) },
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
