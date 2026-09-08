# ParkingLot — 初始设计与实施计划

> **状态**：已实施（Phase 1–5 完成，真实 Chrome 152 端到端验证通过；本文件已与实现同步，命令命名/事件/默认引擎以 `skills/parkinglot/references/protocol.md` 为准）
> **项目**：ParkingLot — 面向 AI Agent 的浏览器控制基础设施
> **组件**：`parkinglot-server`（relay 守护进程）、`parkinglot-extension`（Chrome MV3 扩展）、`@parkinglot/protocol`（共享协议包）、`parkinglot` skill（Agent 使用指南）

---

## 1. 项目概述

### 1.1 愿景

让 AI Agent 通过一套简单、稳定、可审计的接口控制真实浏览器——打开页面、点击、输入、滚动、提取内容、截图、搜索、在页面上下文里做网络请求。浏览器由人类用户在自己机器上以扩展形式在线，Agent 以命令方式访问，二者通过本地 relay 解耦。

### 1.2 名词表

| 术语                     | 含义                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| **Agent**                | LLM 驱动的程序（本项目的使用者），通过 `pl` CLI（或 HTTP）向 server 发命令                 |
| **parkinglot-server**    | 常驻 relay 守护进程（Node + TypeScript）。一面接扩展的 WebSocket，一面接 Agent 的 CLI/HTTP |
| **parkinglot-extension** | Chrome Manifest V3 扩展。持有 WebSocket 连接，把命令翻译为真实的浏览器操作                 |
| **Session**              | 逻辑层寻址单元：`{ id, tabId, mode, navId, ... }`，由 server 维护，提供命令的连续性        |
| **Tab**                  | 物理层寻址单元：浏览器标签页（extension 的 `tabId`）                                       |
| **navId**                | 导航代数。每次页面导航递增，用于让 Agent 感知"页面上下文是否已变化"                        |
| **Context 快照**         | 每个命令响应都携带的 `{ url, title, navId }`，Agent 据此自证看到的是哪个页面               |

### 1.3 系统形态

```
┌────────────┐   pl goto https://x   ┌───────────────────┐   WebSocket    ┌─────────────────────┐
│   Agent    │ ────────────────────▶ │  parkinglot-server │ ─────────────▶ │  parkinglot-extension │
│  (LLM)     │ ◀──────────────────── │   (relay 守护进程)  │ ◀───────────── │   (Chrome MV3)       │
└────────────┘   result + context    └───────────────────┘    token 配对   └──────────┬──────────┘
                                  ▲       │                                              │ CDP + content script
                                  │       └─ 命令账本 / HITL 队列 / session registry      ▼
                                  │                                               真实浏览器页面
                    可选：POST /api/command  (供长驻 Agent 框架)
```

- **Agent ↔ server**：常态为 CLI 子进程（每次一条命令），可选 HTTP 端点供长驻进程集成。**不使用 WebSocket**。
- **server ↔ extension**：WebSocket 长连接（`127.0.0.1` + token 配对），扩展在线状态由 server 维护。

### 1.4 关键架构决策（ADR 摘要）

| #     | 决策                                                                 | 理由                                                                                 |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ADR-1 | Agent 走 CLI + 可选 HTTP，不走 WebSocket                             | CLI 子进程是 Agent 调用的常态，进程天然无状态；session registry 在 server 侧保存状态 |
| ADR-2 | 状态由 extension（浏览器侧）持有，server 只持 session 映射           | 浏览器上下文只在浏览器进程内才有意义，CLI 进程不可持有它                             |
| ADR-3 | 寻址分层：`--session` > `--tab` > 默认 session > 最近活跃 tab        | 逻辑层（session）管连续性，物理层（tab）管精确寻址，快照管感知                       |
| ADR-4 | 每个命令响应强制携带 `context {url,title,navId}`                     | 让 Agent 每次都能自证页面是否变化，即使跨 tab 或被夺焦                               |
| ADR-5 | 协议仿 CDP/Playwright：JSON-RPC 风格 `id/method/params/result/error` | 与主流浏览器控制协议心智一致，事件可扩展                                             |
| ADR-6 | 默认绑 `127.0.0.1` + token；`eval` 默认禁用                          | 浏览器控制是极高权限面，最小暴露 + 显式授权                                          |
| ADR-7 | v1 不做页面级网络请求拦截/事件流订阅/多扩展编排/Firefox              | Gall's Law：先做最小闭环                                                             |

---

## 2. 协议设计（`@parkinglot/protocol`）

### 2.1 传输层

- **extension ↔ server**：WebSocket，文本帧，JSON 编码。
- **server ↔ Agent CLI**：CLI 子进程内部生成请求消息，与 WS 同一套信封，无传输差异。
- 编码一律 UTF-8 JSON；大小限制（默认 10MB，超出报 `MESSAGE_TOO_LARGE`）。

### 2.2 消息信封

```
Request:
  { "id": "string", "method": "string", "params": { ... } }

Response (成功):
  {
    "id": "string",
    "result": {
      "sessionId": "string",
      "tabId": "number",
      "context": { "url": "string", "title": "string", "navId": "number" },
      "data": { ... }            // 命令特有结果
    }
  }

Response (失败):
  { "id": "string", "error": { "code": "string", "message": "string", "data": { ... }? } }

Event (extension → server，server 可选转发):
  { "event": "page.navigated" | "extension.connected" | "extension.disconnected" | "approval.requested" | "approval.responded" | "Network.*", "params": { ... } }
```

- `id`：请求方生成（CLI 用自增序号；HTTP 用 UUID）。
- 超时：默认 30s（CLI 可用 `--timeout` 覆盖），超时报 `TIMEOUT`。
- 校验：两端用 Zod schema（Postel's Law：发送保守、接收宽容；未知字段忽略，缺省字段用默认值）。

### 2.3 寻址模型与连续性

```
命令 params 中可选寻址字段（按优先级）：
  1. params.sessionId        — 显式指定逻辑会话
  2. params.tabId            — 显式指定物理标签页（隐式临时 session）
  3. （缺省）server 的默认 session（持久化于 state file）
  4. 兜底：最近活跃 tab；无可用 tab 时返回 EXTENSION_NO_TAB

响应中的 context 快照是连续性的"自证"：
  - URL / title 变化 → 页面跳转了
  - navId 递增 → 发生了导航
  - tabId 变化 → 焦点被切走（session 不动，tabId 随 session 迁移或报 SESSION_TAB_MOVED）
```

Session 生命周期：

```
goto <url> (无 session) → server 创建 session { id, tabId, mode: auto }，写 state file，返回 sessionId
后续命令不带 sessionId  → 默认复用该 session
session list / use / new / close → 显式管理
session 关闭或 tab 关闭 → 从 registry 移除；下次命令自动兜底或报错
```

### 2.4 命令全集（v1）

| 分类       | 命令               | 参数（要点）                                                         | 返回                                            | 写操作                                                              |
| ---------- | ------------------ | -------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| 导航       | `goto`             | `url`（限 http/https）、`waitUntil`（`load`/`domcontentloaded`）     | `context`                                       | ✔                                                                   |
|            | `back` / `forward` | —                                                                    | `context`                                       | ✔                                                                   |
|            | `reload`           | —                                                                    | `context`                                       | ✔                                                                   |
| 交互       | `click`            | `selector`（CSS）                                                    | `ElementInfo`                                   | ✔                                                                   |
|            | `click-text`       | `text`（可见文本，模糊匹配 + 去重）                                  | `ElementInfo`                                   | ✔                                                                   |
|            | `fill`             | `selector`, `value`                                                  | `ElementInfo`                                   | ✔                                                                   |
|            | `type`             | `selector`, `text`（逐键）                                           | `ElementInfo`                                   | ✔                                                                   |
|            | `press`            | `selector`?, `key`（`Enter`/`Tab`/…）                                | `ElementInfo`                                   | ✔                                                                   |
|            | `hover`            | `selector`                                                           | `ElementInfo`                                   | ✔                                                                   |
|            | `select`           | `selector`, `value`/`label`                                          | `ElementInfo`                                   | ✔                                                                   |
| 滚动/视图  | `scroll`           | `direction`（`up`/`down`/`top`/`bottom`）或 `selector` 或 `amount`   | 滚动后视口摘要                                  | ✔                                                                   |
|            | `screenshot`       | `format`（png/jpeg）、`fullPage`（实验，v1 仅 viewport）、`path?`    | base64（CLI `--path` 写文件）                   | 否                                                                  |
| 提取       | `extract`          | `mode`（`text`/`structured`）、`limit?`（字符裁剪）                  | `PageSnapshot`（可见文本、标题、URL、视口尺寸） | 否                                                                  |
|            | `get-page-info`    | —                                                                    | url/title/视口/滚动位置                         | 否                                                                  |
| 页面内网络 | `fetch`            | `url`、`method`、`headers`、`body`、`returnType`（text/json/binary） | 状态码、头、体（有大小上限）                    | 视方法                                                              |
|            | `search`           | `query`、`engine`（默认 DDG html，`google` 可选）                    | 结果列表（标题/URL/摘要）                       | 否                                                                  |
| 标签页     | `list-tabs`        | —                                                                    | `TabInfo[]`（id/title/url/active）              | 否                                                                  |
|            | `create-tab`       | `url`                                                                | `TabInfo`                                       | ✔                                                                   |
|            | `close-tab`        | `tabId?`                                                             | —                                               | ✔                                                                   |
|            | `activate-tab`     | `tabId`                                                              | `TabInfo` + `context`                           | ✔                                                                   |
| 等待       | `wait`             | `ms` 或 `selector`（等到可见）或 `condition`（`networkidle`/`load`） | `context`                                       | 否                                                                  |
| 会话       | `ping`             | —                                                                    | `{ pong, version, extensionConnected }`         | 否                                                                  |
|            | `get-status`       | —                                                                    | 扩展在线、session 列表、配置摘要                | 否                                                                  |
| 高级       | `eval`             | `expression`                                                         | 序列化结果                                      | **默认禁用**，需 `PARKINGLOT_ENABLE_EVAL=1` + session `mode: trust` |

> 定位器统一约定：CSS selector 作用于文档；`click-text` 走文本定位（可见性过滤 + 取唯一最优点）。后续可扩展 Playwright 风格 `locator` 字符串（`css=`/`text=`/`role=` 前缀）。

### 2.5 事件（v1 最小集 + 扩展点）

方向：除 `approval.respond`（扩展 → server 控制）外均为扩展 → server 的上报/审计事件。

| 事件                                             | 触发             | 用途                                            |
| ------------------------------------------------ | ---------------- | ----------------------------------------------- |
| `extension.connected` / `extension.disconnected` | 扩展 WS 状态变化 | 日志、status                                    |
| `extension.tab-activated`                        | 激活标签页变化   | server 维护最近活跃 tab（兜底寻址）             |
| `page.navigated`                                 | 主框架导航完成   | navId 递增、审计                                |
| `approval.requested` / `approval.responded`      | HITL 状态变化    | popup 批准队列（requested 到扩展）              |
| `approval.respond`（扩展 → server）              | popup 批准/拒绝  | 回写 ApprovalManager（HTTP approve 的替代通道） |
| `Network.*`（扩展点，v1 不实现）                 | 页面级网络请求   | 未来流量监控/请求拦截                           |

### 2.6 错误码

| code                                      | 含义                                 |
| ----------------------------------------- | ------------------------------------ |
| `INVALID_REQUEST` / `INVALID_PARAMS`      | 信封/参数校验失败                    |
| `EXTENSION_OFFLINE`                       | 扩展未连接（CLI 提示如何加载扩展）   |
| `EXTENSION_NO_TAB` / `SESSION_TAB_CLOSED` | 无可操作 tab / session 的 tab 已关闭 |
| `SESSION_NOT_FOUND`                       | sessionId 不存在或已失效             |
| `TIMEOUT`                                 | 命令超时（默认 30s）                 |
| `PENDING_APPROVAL`                        | 命令进入 HITL 等待队列               |
| `APPROVAL_DENIED` / `APPROVAL_TIMEOUT`    | HITL 拒绝 / 超时自动拒绝             |
| `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`   | 定位器找不到 / 匹配多个元素          |
| `EVAL_DISABLED`                           | eval 未开启                          |
| `URL_INVALID` / `HOST_NOT_ALLOWED`        | URL 非法 / 域名不在白名单            |

### 2.7 公共类型

```ts
interface ContextSnapshot {
  url: string;
  title: string;
  navId: number;
  tabId: number;
}
interface PageSnapshot {
  context: ContextSnapshot;
  visibleText: string;
  viewport: { w; h };
  scrollY: number;
}
interface ElementInfo {
  tag: string;
  text?: string;
  attrs: Record<string, string>;
  box?: { x; y; w; h };
}
interface SessionInfo {
  id: string;
  tabId?: number;
  mode: SessionMode;
  createdAt: string;
  lastUsedAt: string;
}
type SessionMode = 'auto' | 'ask';
```

---

## 3. Server 设计（`packages/server`）

### 3.1 进程与模块

```
packages/server/src/
  index.ts            # 入口：加载配置 → 起 WS、HTTP、CLI 就绪
  config.ts           # env 配置加载与校验
  ws/server.ts        # WebSocket 服务端：accept/鉴权/注册/心跳
  router.ts           # 命令路由：校验 → 寻址 → 转发 → 超时 → 归一化响应
  session.ts          # SessionRegistry：创建/复用/查询/关闭 + state file（~/.parkinglot/state.json）
  approval.ts         # HITL 队列与状态机
  ledger.ts           # 命令账本（JSON lines 日志）
  cli.ts              # commander 命令行入口（子进程模式）
  http.ts             # 轻量 HTTP 端点
```

### 3.2 WebSocket Relay

- 绑定 `127.0.0.1:PARKINGLOT_PORT`（默认 8787）。
- 扩展连接时发 `hello { token, extensionVersion }`，校验 token（默认通过 `pl pair` 生成并写入扩展配置/URL 参数）。
- 心跳：每 15s ping / pong，失去响应 3 次判定离线。
- 断线：extension 侧指数退避重连（1s→2s→…上限 30s），session registry 保留但标记离线；重连后自动恢复路由。

### 3.3 Session Registry

```ts
interface Session {
  id: string; // pl-<nanoid>
  tabId?: number;
  mode: SessionMode; // auto | ask
  createdAt: string;
  lastUsedAt: string;
  navId: number; // 从扩展同步
}
```

- registry 驻内存；默认 session 的 id 落 `~/.parkinglot/state.json`，容忍 server 重启。
- 每个命令先"寻址"：resolve target → 返回 sessionId/tabId → 命令转发时带上 tabId。
- 命令成功/失败都要更新 `lastUsedAt` 与 context 快照缓存。

### 3.4 CLI（`pl`）

全局选项：`--server <url>`（默认 `http://127.0.0.1:8787`，CLI 走 HTTP 通道）、`--json`、`--timeout <ms>`、`--session <id>`、`--path <file>`（screenshot 写盘）。

| 命令                                                                 | 说明                                          | 默认输出           |
| -------------------------------------------------------------------- | --------------------------------------------- | ------------------ |
| `pl status` / `pl ping`                                              | 扩展在线？server 版本                         | text 摘要          |
| `pl goto <url>`                                                      | 导航（无 session 自动创建）                   | context 快照       |
| `pl back / forward / reload`                                         | 历史导航                                      | context            |
| `pl click <selector>` / `pl click-text <text>`                       | 点击                                          | ElementInfo        |
| `pl fill <selector> <value>` / `pl type <sel> <text>`                | 输入                                          | ElementInfo        |
| `pl press <key>` / `pl hover <sel>` / `pl select <sel> <value>`      | 交互                                          | ElementInfo        |
| `pl scroll [up                                                       | down                                          | top                | bottom                 | amount]` | 滚动 | 视口摘要 |
| `pl screenshot [--path x.png] [--full]`                              | 截图（默认 base64 输出长度摘要 + 可选写文件） | 摘要               |
| `pl extract` / `pl page-info`                                        | 页面可读文本（`--limit` 裁剪）/ 页面信息      | 文本 / 摘要        |
| `pl fetch <url> [...curl 风格选项]`                                  | 页面上下文网络请求                            | 状态码 + 体摘要    |
| `pl search <query>`                                                  | 搜索引擎结果                                  | 结果列表           |
| `pl tabs` / `pl tab <id>` / `pl tab-new <url>` / `pl tab-close [id]` | 标签页列表 / 切换 / 新建 / 关闭               | 列表 / context     |
| `pl wait [--ms N                                                     | --selector css                                | --condition load]` | 等待时间/元素/加载条件 | context  |
| `pl session list/new/use/close/mode`                                 | session 管理（mode: auto/ask）                | 列表/摘要          |
| `pl logs [--follow] [--since]`                                       | 命令账本                                      | JSON lines         |
| `pl approve <id>` / `pl deny <id>`                                   | HITL 远程批准（也可在 popup 操作）            | 状态               |

- 默认 markdown 输出（便于 Agent 阅读）；`--json` 输出结构化结果（含 `context`）便于程序消费。
- 每个命令退出码：0 成功；2 参数错误；3 目标/会话错误；4 扩展离线；5 审批未决/被拒；1 其他。

### 3.5 HTTP 端点（可选通道）

| 端点                    | 说明                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `GET /api/status`       | server 与扩展状态、配置摘要                                         |
| `POST /api/command`     | `{ method, params, sessionId? }` → 与 CLI 同一 Router、同一响应格式 |
| `POST /api/approve/:id` | 批准（body `{ approve: true                                         | false }`） |

HTTP 每次请求用独立随机 id；无鉴权（仅回环），文档注明风险。

> 另有 `POST /api/session`（session 管理：`{ action: new/use/close/mode, id?, mode? }`），供 CLI 会话子命令使用。

### 3.6 Human-in-the-loop（HITL）

状态机（每 session 独立）：

```
                    ┌──────────────┐  写操作 + mode=ask
 命令到达 ─────────▶ │  PENDING      │ ──────────────────────────────▶ 执行 / 拒绝
                    │  (approval)   │ ◀── approve(requestId, true/false)
                    └──────┬───────┘     默认超时 60s → APPROVAL_TIMEOUT
                           └── 只读命令永不挂起（extract/tabs/context 直接执行）
```

- 写操作集合 = 2.4 表中标记 ✔ 的命令（`fetch` 为 conditional：视 HTTP method）。
- 批准渠道：extension popup 批准队列（`approval.respond` 事件）或 `POST /api/approve/:id`（远程）。
- 挂起语义：命令在 server 侧 `await` 审批结果（HTTP/CLI 保持连接）；批准后继续执行，拒绝/超时返回 `APPROVAL_DENIED` / `APPROVAL_TIMEOUT`。

### 3.7 命令账本（流量监控）

- 每次命令（含 HITL 决策）记一行 JSON：`{ ts, id, method, params(截断敏感字段), result/error, durationMs, sessionId, tabId }`。
- 写 `~/.parkinglot/ledger.jsonl`；`pl logs --follow` 实时 tail。
- 敏感字段（cookie/密码等）默认脱敏：记录键名不记值，`body` 截断到 256B。
- v1 监控范围 = 命令级；页面发出的网络请求不做逐条拦截（留 `Network.*` 扩展点）。

### 3.8 配置（env）

| 变量                           | 默认            | 说明                       |
| ------------------------------ | --------------- | -------------------------- |
| `PARKINGLOT_PORT`              | 8787            | 监听端口                   |
| `PARKINGLOT_BIND`              | 127.0.0.1       | 仅回环（勿改 0.0.0.0）     |
| `PARKINGLOT_TOKEN`             | 自动生成        | 扩展连接配对 token         |
| `PARKINGLOT_ALLOWED_HOSTS`     | 空（全部）      | 逗号分隔域名白名单（可选） |
| `PARKINGLOT_DISABLED_COMMANDS` | `eval`          | 禁用的命令列表             |
| `PARKINGLOT_ENABLE_EVAL`       | `0`             | 显式开启 eval              |
| `PARKINGLOT_STATE_DIR`         | `~/.parkinglot` | state/ledger 目录          |

---

## 4. Extension 设计（`packages/extension`）

### 4.1 结构

```
packages/extension/
  manifest.json          # MV3，权限最小化（tabs/scripting/webNavigation/storage/alarms）
  build.config.mjs       # esbuild 构建 → dist/（background/content/popup 三入口）
  popup.html / popup.css # popup 视图
  src/
    background.ts        # service worker：WS 客户端 + 命令路由 + navId 追踪 + popup 消息 + alarms 保活
    content.ts           # content script 入口（消息监听 → dom/actions）
    popup.ts             # popup 逻辑（配置/状态/HITL 批准队列）
    shared/messages.ts   # SW↔content / SW↔popup 内部消息类型
    dom/locator.ts       # CSS + text 定位器（可见性过滤/最深层优先）
    dom/actions.ts       # 交互/提取/滚动/页面内 fetch/搜索解析 实现
    dom/snapshot.ts      # PageSnapshot/可见文本提取
```

> 单测在 `src/dom/*.test.ts`（vitest + happy-dom，`// @vitest-environment happy-dom`）；测试文件无独立 vitest.config.ts。

### 4.2 manifest 权限审计

| 权限                              | 用途                           | 代价说明                                      |
| --------------------------------- | ------------------------------ | --------------------------------------------- |
| `tabs`                            | 列举/激活/监听 tab，读标题 URL | 可见浏览信息                                  |
| `scripting`                       | 向页面注入执行器               | 标准交互前提                                  |
| `host_permissions` (`<all_urls>`) | 对任意站点执行 DOM 操作        | **控制浏览器的固有代价**，README/skill 中明示 |
| `webNavigation`                   | 追踪导航 → navId               | 监控历史                                      |
| `storage`                         | 保存 server URL / token        | 本机                                          |
| `alarms`                          | SW 保活（0.5min 周期唤醒）     | Chrome 120+ 支持最小周期 0.5min               |

> 备用方案：`activeTab` + 用户手势可减小 host_permissions，但会破坏"无人值守批量操作"；v1 选择 `<all_urls>` + 文档明示。

### 4.3 background service worker

- 持 WebSocket（server 地址 + token 来自 storage/popup 配置）。
- 重连策略：指数退避（1s→30s 上限）+ jitter；token 失效提示重新配对。
- 保活：MV3 SW 空闲 ~30s 会被 Chrome 回收。实测采用 `chrome.alarms`（0.5min，manifest 需 `alarms` 权限）周期性唤醒 SW，若 WS 断开则重连——真实 Chrome 152 验证：空闲 85s/70s 均不掉线。更强备选：offscreen document 持连接（未启用，记录于 4.3/10）。注意：SW 顶层任何 API 抛错会中断全部监听器注册（曾因缺 `alarms` 权限导致 popup/WS 全失效），关键块需 try/catch 防御。
- 消息路由：收到命令 → 解析 tabId → `chrome.tabs.sendMessage` 到对应 tab 的 content script（无 tab 的会话级命令直接处理）→ 汇总响应。content script 若未注入则动态注入。
- navId 追踪：`chrome.webNavigation.onCommitted`（mainFrame, isTopLevel）自增 navId，随响应回传 → server 同步 context 快照。

### 4.4 content script 执行器

- 单文件自包含（避免与页面 JS 冲突，用 IIFE + 沙箱隔离子域）。
- 定位器：CSS（`document.querySelector`）+ text 定位（遍历可见元素，模糊/精确匹配，可见性过滤，歧义报 `TARGET_AMBIGUOUS`）。
- 交互：原生 `el.click()`、`dispatchEvent` 兼容组合 + `input`/`change` 事件（适配 React/Vue 受控组件）；`type` 逐键。
- 提取：可见文本（`innerText` 近似 + 链接/按钮归并）、视图/滚动信息。
- 截图：MV3 用 `chrome.tabs.captureVisibleTab`（background 执行）+ 可选 canvas 全页拼接（v1：仅 visible viewport；`fullPage` 标记为实验）。
- 超时与错误归一化：命令内 `wait` 循环（默认 5s 可配）后报 `TARGET_NOT_FOUND` 等标准码。

### 4.5 popup（HITL 控制台）

- 配置区：server URL、token，连接状态灯，`保存并连接`。
- 批准区：HITL pending 队列（命令摘要 + 批准/拒绝按钮），`ask` 模式提示。
- 日志区（可选）：最近一次响应摘要。

---

## 5. Parkinglot Skill 设计

安装在 `skills/parkinglot/SKILL.md`（与 `.agents/skills/` 通过符号链接互通）。大纲：

```
metadata: 名称、适用场景（需要浏览器操作时）、触发词
1. 前置：启动 server（用 pnpm --filter @parkinglot/server start）、加载扩展并配对（打开 chrome://extensions → Load unpacked → packages/extension/dist）
2. 命令参考：表格（链接 references/protocol.md）
3. 会话心智模型：session / tab / navId / context 快照——"响应里的 context 变了就是页面变了"
4. 标准工作流模板：
   - 查资料：search → goto top result → extract → 滚动 → extract
   - 填表登录：goto → fill → click → wait → extract（校验结果）
   - 截图汇报：goto → scroll → screenshot --path
   - fetch：页面上下文请求（带登录态）
5. 错误与故障排查：EXTENSION_OFFLINE、TARGET_NOT_FOUND、PENDING_APPROVAL、超时
6. 安全须知：token 不泄露、eval 默认禁用、host_permissions 的代价
```

---

## 6. 安全模型

| 威胁                         | 缓解                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| 本地其他进程控制浏览器       | WS 仅回环 + token；CLI/HTTP 无鉴权但仅回环（文档明示风险）         |
| 远端注入（Agent 发恶意命令） | `ALLOWED_HOSTS` 白名单（可选）；URL 限 http/https；`eval` 默认禁用 |
| XSS 页面诱导扩展操作         | content script 沙箱化、不转发页面内事件、命令参数不进 innerHTML    |
| 凭证泄露                     | 命令账本脱敏（cookie/密码只记键名）；截图/文本输出默认截断         |
| 页面网络被监控               | `Network.*` v1 不实现 = 无页面级流量采集，仅有命令级账本           |
| 未授权 HITL 绕过             | 拒绝/超时默认安全（fail-closed），approve 端点仅回环               |

---

## 7. LLM 使用示例（工作流模板）

```
$ pl search "parkinglot browser extension"          # → 结果列表 [1..n]
$ pl goto https://github.com/xxx/parkinglot          # → context{url,title,navId=1}
$ pl extract                                         # → 页面可读文本
$ pl click-text "Installation"                       # → ElementInfo
$ pl scroll down                                     # → 视口摘要
$ pl screenshot --path docs/example.png              # → 已写入文件
$ pl fetch https://api.github.com/repos/xxx --json   # → 页面上下文请求（带登录态）
$ pl tabs                                            # → 多 tab 时显式切换
```

Session 连续性：

```
$ pl goto https://example.com          # 自动创建 session S1, navId=1
$ pl click-text "Login"                # 默认 S1 → context 仍是 example.com
$ pl goto https://other.com            # S1 内导航 → navId=2, url=other.com ← Agent 立刻感知
$ pl session list / use S1 / close S1  # 显式管理
```

---

## 8. 实施计划

### Phase 1：Bootstrapping 项目骨架

- 用 `bootstrapping` 技能扫描仓库（当前为空仓库 + `.agents/skills`）并确认前置条件：**本机需安装 Node ≥ 20 与 pnpm ≥ 9**（当前环境未检测到 node/pnpm，先安装并验证 `node -v` / `pnpm -v`）
- 生成根级基础件：`pnpm-workspace.yaml`、根 `package.json`、`tsconfig.base.json`、`.gitignore`、`README.md`、`LICENSE`（MIT）、`AGENTS.md`、ESLint/Prettier、根级 `build`/`test`/`typecheck` scripts
- 建立 `packages/protocol`、`packages/server`、`packages/extension` 三包骨架（各自 `package.json`/`tsconfig`/入口占位）
- 验证：`pnpm install` 成功；`pnpm typecheck` 通过；`pnpm test` 有首个通过用例

### Phase 2：协议层 `@parkinglot/protocol`

- 信封类型：`Request/Response/Error/Event` + 类型守卫；寻址字段 `sessionId/tabId`
- 命令 type union 与 `Params↔Result` 映射；事件类型（`page.navigated`、`approval.*`、`Network.*` 位）
- 公共类型 `ContextSnapshot/PageSnapshot/ElementInfo/SessionInfo`；错误码枚举
- Zod schema：请求/响应校验（Postel）
- vitest：信封、命令参数校验、错误码归一化
- 产物：`skills/parkinglot/references/protocol.md`（命令参考，skill 引用的权威文档）

### Phase 3：`parkinglot-server`（CLI + Relay + HITL + 账本）

- WS server：鉴权/注册/心跳/离线检测
- SessionRegistry + state file 持久化；命令寻址优先级解析；context 快照缓存
- Router：校验 → 转发 → 超时（30s）→ 错误映射
- 命令账本：JSON lines + 脱敏；`pl logs --follow`
- HITL：pending 队列、approve/deny、写/只读分类、超时失败
- CLI 全集（2.4 表 + session/logs/approve 管理命令），markdown/`--json` 输出
- HTTP 端点：`/api/status`、`/api/command`、`/api/approve/:id`
- 单测：寻址优先级、session 生命周期、离线/超时/审批状态机

### Phase 4：`parkinglot-extension`（MV3）

- MV3 骨架 + esbuild 构建 + manifest 权限审计
- background：WS 客户端（token/重连/保活实测）+ 路由 + navId 追踪（webNavigation）
- content script 执行器：定位器（CSS+text）、交互、提取、滚动、fetch、search、tab 命令、wait/超时/错误归一化
- popup：配置 + 状态 + HITL 批准队列
- 单测：locator 解析、tab 路由、snapshot 纯逻辑（DOM mock）

### Phase 5：parkinglot skill + 端到端接通

- 编写 `parkinglot` SKILL.md 并安装为 project skill（沿用 `.agents/skills/` 目录）
- 端到端冒烟：起 server → 加载扩展配对 → CLI 走通 goto/extract/click/scroll/screenshot/fetch/search → 验证 session 连续性（两次命令同一 context，navId 递增）
- 收尾：README quick start、AGENTS.md 更新、`skills/parkinglot/references/protocol.md` 核对、首次 git 提交

### 验收标准（MVP done）

1. `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿（三个包）
2. 扩展可在 Chrome 加载，popup 显示连接成功
3. 以下 CLI 命令对真实页面端到端可用：`status/goto/extract/click-text/fill/scroll/screenshot/tabs/session/fetch/search`
4. session 连续性验证通过（同 session 两次命令 context 一致，导航后 navId 递增且 url 变化）
5. `pl logs --follow` 能实时看到命令账本且敏感字段脱敏
6. HITL：`ask` 模式下写操作挂起 → popup 批准 → 执行；拒绝/超时路径正确
7. `eval` 默认禁用且尝试调用返回 `EVAL_DISABLED`

---

## 9. 范围外（v1 明确不做 / YAGNI）

- 页面级网络请求拦截与事件流订阅（`Network.*`）
- 多扩展实例编排 / 多 server 集群
- Firefox（及 Safari）支持
- 持久化 Cookie 管理、profile 导入导出
- 视觉模型（截图→元素映射）、无障碍树驱动
- 远程部署（本项目默认本机回环模式）

## 10. 待决问题 / 后续扩展（当前状态）

- SW 保活：alarms 方案已实现并真机验证（空闲 85s/70s 不掉线）→ **offscreen document 迁移暂缓**（更强备选，连接中断窗口可进一步趋零时再启用）
- HITL：popup 批准队列已保留并接通 `approval.respond` 链路（单测 + mock 端到端验证；真机 popup 交互待用户实操）
- `fullPage` 截图：参数存在但 v1 仅 captureVisibleTab 视口，**滚动拼接未实现**（协议标记实验）
- session 命名：`--session` 之外更友好的别名（未做）
- 实测发现并已修复的坑（记录）：manifest 需 `alarms` 权限否则 SW 顶层崩溃；`captureVisibleTab` 需 windowId；页面 fetch 默认 `credentials: 'same-origin'`（跨域 `'include'` 会被 `ACAO:*` API 拒绝）；`search` 默认引擎为 DDG html 版（Google 需 `--engine google`，真实解析已验证）
