# ParkingLot

面向 AI Agent 的浏览器控制基础设施。Agent 通过 `plt` CLI（或 HTTP）向 `parkinglot-server` 发送命令，server 经 WebSocket 转发到 `parkinglot-extension`（Chrome Manifest V3 扩展），由扩展在你自己的真实浏览器中执行——打开页面、点击、输入、滚动、提取内容、截图、搜索、带登录态的页面内请求。

```
┌────────────┐   plt goto https://x   ┌───────────────────┐   WebSocket    ┌─────────────────────┐
│   Agent    │ ────────────────────▶ │  parkinglot-server │ ─────────────▶ │  parkinglot-extension │
│  (LLM)     │ ◀──────────────────── │   (relay 守护进程)  │ ◀───────────── │   (Chrome MV3)       │
└────────────┘   result + context    └───────────────────┘    token 配对   └──────────┬──────────┘
                                                                             真实浏览器页面
```

## 特性

- **24 个命令**：导航（goto/back/forward/reload）、交互（click/click-text/fill/type/press/hover/select）、视图（scroll/screenshot）、提取（extract/page-info）、页面内网络（fetch/search）、标签页管理、等待、会话查询。
- **真实登录态**：一切在你自己的浏览器会话中执行（cookie、登录、反爬环境），`fetch` 可携带登录态。
- **连续性模型**：session / tab / navId + 每个响应的 `context` 快照，Agent 始终能自证页面是否已变化。
- **Human-in-the-loop**：session 可切 `ask` 模式，写操作需经扩展 popup（或 `plt approve`）批准。
- **可审计**：命令账本（JSON lines）实时记录，敏感字段自动脱敏（`plt logs`）。
- **安全默认**：server 仅绑 `127.0.0.1` + token 配对；`eval` 默认禁用。

## 仓库结构（pnpm workspace）

| 包                                             | 说明                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/protocol` (`@parkinglot/protocol`)   | 共享协议：消息信封、命令全集、公共类型、Zod 校验                         |
| `packages/server` (`@parkinglot/server`)       | relay 守护进程：WebSocket 服务端、`plt` CLI、session 注册、HITL、命令账本 |
| `packages/extension` (`@parkinglot/extension`) | Chrome MV3 扩展：WebSocket 客户端、content script 执行器、popup 控制台   |

## 前置条件

- Node.js ≥ 20（运行 server，`npm install -g @parkinglot/server` 安装）
- Chrome / Chromium ≥ 120（运行扩展，从 Chrome Web Store 安装）

## 完整使用指南

### 第 1 步：安装并启动 server

```bash
npm install -g @parkinglot/server

# 启动 relay（阻塞前台；另开终端做后续操作）
plt serve
```

启动输出类似：

```
parkinglot-server listening on http://127.0.0.1:8787
extension websocket: ws://127.0.0.1:8787/ws
pair token: e59fd1316be7aa2fb839fd016fbe1b0b589ce08ee6af2db3
```

记下 **pair token**。token 持久化在 state 目录（默认 `~/.parkinglot/token`），重启 server 不变，Chrome 侧配对一次即可（可用 `plt serve --token <自定义>` 覆盖）。

> 贡献者/源码方式：`pnpm install && pnpm build` 后 `pnpm --filter @parkinglot/server start`（等价于 `plt serve`）。

### 第 2 步：安装扩展

从 Chrome Web Store 安装：

<https://chromewebstore.google.com/detail/ajpkphgdonekdpifjhfffffjhikiafdj>

> 开发/调试可用源码方式：`chrome://extensions` → 开发者模式 → **加载已解压的扩展程序** → `packages/extension/dist`（Chrome 137+ 已移除 `--load-extension` 命令行参数，只能这样加载）。

### 第 3 步：配对（一次性）

1. 点击工具栏拼图图标 → ParkingLot（可固定到工具栏）；
2. 填入 **Server URL** `http://127.0.0.1:8787` 与 **pair token**；
3. 点 **Save & Connect**；按钮变为 **Connected ✓**、状态灯变绿即成功。

配对信息保存在扩展的 `chrome.storage`，Chrome 重启后扩展会自动重连，无需重复操作。

### 第 4 步：Agent 侧安装 parkinglot skill（可选）

让 AI Agent 按标准工作流驱动浏览器：

```bash
npx skills add myz-suite/parkinglot --skill parkinglot
```


### 第 5 步：验证连接

```bash
plt status
# extension: connected ✅
# sessions: 0
```

> `plt` 随 `@parkinglot/server` 一起安装为全局命令。源码方式可用 `node packages/server/dist/cli.js status`。

### 第 6 步：控制浏览器

```bash
plt goto https://example.com    # 首次自动创建 session；响应带 context 快照
plt extract                     # 页面可读文本
plt page-info                   # url/标题/视口/滚动位置
plt click-text "Learn more"     # 按可见文本点击（真实点击 → 页面导航）
plt scroll down                 # 滚动
plt screenshot --path shot.png  # 截图写入文件
plt search "parkinglot"         # Google 搜索结果（默认引擎）；--page 2 取下一页
plt fetch https://api.github.com/zen --header "Accept: application/json"
plt logs --tail 20              # 命令账本
```

## CLI 命令参考

全局选项：`--server <url>`（默认 `http://127.0.0.1:8787`）、`--json`（结构化输出）、`--timeout <ms>`（默认 30000）、`--session <id>`、`--path <file>`（screenshot 落盘）。

| 命令                                                         | 说明                                         |
| ------------------------------------------------------------ | -------------------------------------------- |
| `plt status` / `plt ping`                                      | 扩展在线？server/协议版本                    |
| `plt goto <url>`                                              | 导航（无 session 自动创建）                  |
| `plt back` / `forward` / `reload`                             | 历史导航                                     |
| `plt click <css>` / `plt click-text <text>`                    | 点击元素 / 按文本点击                        |
| `plt fill <css> <value>`                                      | 填充输入框（整体替换）                       |
| `plt type <css> <text>`                                       | 逐键输入                                     |
| `plt press <key> [--selector <css>]`                          | 按键                                         |
| `plt hover <css>`                                             | 悬停                                         |
| `plt select <css> --value <v>`（或 `--label <l>`）            | 选择下拉项                                   |
| `plt scroll <up\|down\|top\|bottom\|amount>`                  | 滚动                                         |
| `plt screenshot [--path x.png] [--format png\|jpeg]`          | 截图（`--full` 为实验性）                    |
| `plt extract [--limit N]`                                     | 页面可读文本（LLM 友好裁剪）                 |
| `plt page-info`                                               | 页面 url/标题/视口/滚动                      |
| `plt fetch <url> [--method] [--header "k: v"]… [--body]`      | 页面上下文网络请求（带登录态）               |
| `plt search <query> [--engine google\|duckduckgo] [--page N]` | 搜索引擎结果（默认 google；google 支持分页） | 结果列表 + 页码 |
| `plt tabs`                                                    | 列出标签页                                   |
| `plt tab <id>` / `plt tab-new <url>` / `plt tab-close [id]`     | 切换 / 新建 / 关闭标签页                     |
| `plt wait [--ms N \| --selector css \| --condition load]`     | 等待                                         |
| `plt session list\|new\|use\|close\|mode`                     | session 管理                                 |
| `plt logs [--tail N] [--follow]`                              | 命令账本                                     |
| `plt approve <requestId>` / `plt deny <requestId>`             | 远程批准 / 拒绝 HITL 请求                    |

退出码：`0` 成功 · `2` 参数错误 · `3` 目标/会话错误 · `4` 扩展离线 · `5` 审批未决/被拒 · `6` 超时 · `1` 其他。

## 连续性模型（session / tab / navId）

- **Session** 是逻辑目标。首次 `plt goto` 自动创建并成为默认，后续命令默认作用于它；用 `plt session` 管理。
- **tabId** 是物理标签页；**navId** 每次导航递增。
- 每个响应都带 `context {url, title, navId, tabId}` 快照——**`context` 变了就是页面变了**（url/title 变化 = 跳转；navId 递增 = 发生了导航）。Agent 应先读响应里的 context，再决定是否依赖之前提取的内容。

```bash
plt goto https://example.com    # session=pl-xxx, navId=1
plt extract                     # 同一 session，navId 不变
plt click-text "Learn more"     # 页面导航到 iana.org → navId=2, url 变化 ← 立刻感知
```

## Human-in-the-loop

```bash
plt session mode <id> --mode ask   # 该 session 进入 ask 模式（默认 auto）
plt click-text "Delete"            # 写操作挂起，等待批准
# 方式 A：扩展 popup 的批准队列点 ✔/✖
# 方式 B：plt approve <requestId> / plt deny <requestId>（requestId 来自 plt status --json 或 /api/status）
```

- 只读命令（extract/tabs/page-info…）永不挂起。
- 拒绝/超时（60s）默认不执行（fail-closed）。
- 会话恢复 `plt session mode <id> --mode auto`。

## 配置（server 环境变量）

| 变量                           | 默认                                     | 说明                        |
| ------------------------------ | ---------------------------------------- | --------------------------- |
| `PARKINGLOT_PORT`              | 8787                                     | 监听端口                    |
| `PARKINGLOT_BIND`              | 127.0.0.1                                | 仅回环（勿改 0.0.0.0）      |
| `PARKINGLOT_TOKEN`             | 自动生成（持久化 `~/.parkinglot/token`） | 扩展配对 token              |
| `PARKINGLOT_ALLOWED_HOSTS`     | 空（全部）                               | 域名白名单（逗号分隔）      |
| `PARKINGLOT_DISABLED_COMMANDS` | `eval`                                   | 禁用命令列表                |
| `PARKINGLOT_ENABLE_EVAL`       | `0`                                      | 显式开启 eval               |
| `PARKINGLOT_STATE_DIR`         | `~/.parkinglot`                          | state / ledger / token 目录 |

## 常见工作流

```bash
# 查资料
plt search "playwright vs puppeteer"
plt goto https://github.com/...        # 从结果挑一个
plt extract --limit 3000
plt scroll down && plt extract --limit 3000

# 填表
plt goto https://example.com/login
plt fill "#username" alice
plt fill "#password" "***"
plt click-text "Sign in"
plt wait --condition load && plt extract

# 带登录态的 API 请求（在已登录站点页面执行）
plt fetch https://api.github.com/user --header "Accept: application/json"
```

## 故障排查

| 现象                                    | 处理                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `EXTENSION_OFFLINE`                     | 扩展未配对/掉线：打开 popup 确认 **Connected ✓**；server 是否在跑、token 是否一致                                             |
| popup 点保存无反应                      | 扩展需重新加载：chrome://extensions → ParkingLot → 刷新按钮（每次 `pnpm build` 后都要）                                       |
| `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS` | 先 `plt extract` 看页面实际内容；改用更具体的 CSS selector                                                                     |
| `SESSION_NOT_FOUND` / `No tab with id`  | session 指向的标签页被关闭：`plt session close <id>` 后重新 `plt goto`                                                          |
| `TIMEOUT`                               | 页面慢：`--timeout 60000` 重试                                                                                                |
| 命令作用到 Chrome 内部页报错            | content script 无法注入 `chrome://` / Web Store 页——先在普通网页上操作                                                        |
| `search` 结果为空/需更多                | 反爬/验证码：换 `--engine duckduckgo` 或 `plt goto` 直接访问；取更多结果用 `--page 2`（google 支持，duckduckgo 不支持 offset） |

## 安全须知

- server 只绑 `127.0.0.1`；扩展连接需 token。token 是密钥，勿外泄。
- 扩展需要 `host_permissions <all_urls>`——这是"能控制任意页面"的固有代价；请只在你信任的机器/环境使用。
- `eval` 默认禁用（`EVAL_DISABLED`），需 server 显式开启。
- 命令账本自动脱敏敏感字段（password/token/headers/body…），`plt logs` 可见。

## 开发

```bash
pnpm install          # 安装依赖
pnpm typecheck        # tsc --noEmit（三包）
pnpm test             # vitest 单测（108 个用例）
pnpm test:e2e         # Playwright E2E（需先 pnpm exec playwright install chromium；加载真实扩展跑配对/导航/连续性）
pnpm build            # 编译 dist（server/protocol）+ esbuild 打包扩展
pnpm lint / pnpm format
```

代码约定：TypeScript strict + ESM、vitest 测试与源码同目录（`src/*.test.ts`）、Conventional Commits。E2E 位于 `tests/e2e/`（`playwright.config.ts`；用 Playwright 捆绑 Chromium 加载扩展 + storage 自动配对，headless 可跑）。详见 `AGENTS.md`。

## 文档

- `README.md`（本文件）— 使用说明
- `docs/initial-plan.md` — 初始设计与实施计划（架构、协议、安全模型、验收标准）
- `docs/protocol.md` — 协议参考（指向 `skills/parkinglot/references/protocol.md`，中文版 `protocol.zh.md`）
- `skills/parkinglot/` — `parkinglot` skill（Agent 调用指南）及其 `references/protocol.md`
- `docs/release-plan.md` — Chrome Web Store 发布准备清单

## 许可证

MIT
