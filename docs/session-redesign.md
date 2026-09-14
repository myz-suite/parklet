# Session Redesign — 浏览器上下文模型

状态：**DEFERRED（未执行）** —— 用户决定先不移除/重设计 session 之外的大改，改为**直接移除 session 概念**（见 `docs/kimi-export-journal.md` 第 12 节）。本文档保留为后续（多浏览器 / 后台自动化 tab / 并发编排）的候选设计。
关联：`docs/kimi-export-journal.md`（11.5 泄漏根因）、`docs/v3-incremental-plan.md`

## 1. 动机

现状（`packages/server/src/session.ts`）：

- `Session = { id, tabId?, createdAt, lastUsedAt, context? }` —— 逻辑身份与物理 tab **硬绑定**。
- `resolve()` 默认分支要求 `s.tabId !== undefined`；`unbindTab` 清掉后默认 session **永久失效** → 每次 `goto` 落 `latestTabId` 分支并 `create()`，`create()` 又不改默认 → **每次泄漏一个 session**（实测 414 条）。
- 缺失 `tabId` 时扩展用 `activeTabId()` → 自动化**抢用户正在看的页面**。
- `ExtensionHub` 单连接（新连接替换旧连接）→ **无法多浏览器**。

## 2. 目标 / 非目标

**目标**

- Session = **浏览器上下文**（逻辑 tab 分组），**不再绑定 tabId**。
- 每个 session 一个 **专属后台自动化 tab**（`active:false` + `pinned`），由扩展托管、按需创建、失效自愈、**可找回**。
- `--tab` 可**临时**操作用户 tab（不并入 session）。
- **多浏览器**：多扩展连接 + `browserId` 路由（含 `browserId` 全网透传）。
- 并发：**同 session 串行**（无界 FIFO + 每命令超时），**跨 session 并行**。

**非目标（本期）**

- cookie/登录**隔离**（共享同一 profile；预留 `contextKind=false`）。
- Tab Group 归类（选择 inactive+pin）。
- 多浏览器下的默认浏览器自动选择（多连接时**必须显式** `--browser`）。

## 3. 模型

### Server

```
Browser  { browserId, label?, connected, latestTabId?, lastSeenAt }
Session  { id, name?, browserId, createdAt, lastUsedAt, context? }   // 无 tabId
```

- 每个 browser 一个**默认 session**（首次命令自动创建）。
- state file：`sessions[]`（id/name/browserId/createdAt/lastUsedAt）+ `defaultSessionByBrowser`。
- `context` 仅存易失快照，不持久化 tab 绑定。

### Extension

```
automationTabs: Map<sessionId, tabId>   // chrome.storage.session 持久化，防 SW 回收丢失
```

- **标记**：自动化 tab 标题加前缀（如 `[PL]`）+ URL/`data-*` 无法跨导航保留，故以标题前缀作为回收标记。
- `ensureAutomationTab(sessionId)`：
  1. 内存映射命中且 tab 存活 → 复用；
  2. 否则按标记 `chrome.tabs.query` **找回**（SW 回收/SW 重启场景）→ 复用；
  3. 否则 `chrome.tabs.create({ active:false, pinned:true })` 并写映射。
- `chrome.tabs.onRemoved` → 清映射（自愈）。

## 4. 寻址与路由

命令 params：`sessionId?`、`tabId?`、`browserId?`（CLI：`--session`、`--tab`、`--browser`）。

解析顺序：

1. **browser**：显式 `browserId`（id 或 label）> 若显式 `tabId` 则其所属 browser（仅一个 browser 连接时可推断，否则需显式）> `sessionId` 的 browser > 默认 session。
   - 已连接多个 browser 且无法确定 → **`AMBIGUOUS_BROWSER`**。
2. **target**：显式 `tabId`（临时使用）> `sessionId` → 该 session 的自动化 tab（扩展 get/create）。
3. 转发 wire request：`{ browserId, sessionId, tabId? }`。

**browserId 全网透传（P0-3 决策）**：响应信封、事件、账本、错误 data、`context` 展示、`plt events`/`tabs` 均带 `browserId`，消除 tabId 跨浏览器歧义。

## 5. 多浏览器 Hub

- 扩展 `hello` 上报 `{ token, instanceId, label? }`；`browserId = instanceId`（持久化于 `chrome.storage`）。
- `ExtensionHub`：`Map<browserId, conn>`；新连接仅替换**同 browserId** 的旧连接。
- 命令按 `browserId` 路由；`ping`/`get-status` 返回浏览器列表；事件带 `browserId`。
- **兜底**：仅一个连接时，未显式指定的命令自动指向它（避免单浏览器场景强加 `--browser`）；重装导致 browserId 变化时，单连接可自动认领旧默认 session。

## 6. 并发（P0-4 决策）

- **每 session 一个无界 FIFO 队列**（server 侧）：同 session 串行，跨 session 并行。
- 每命令仍有 `TIMEOUT`；`wait` 等长命令会阻塞同 session 后续命令（可接受，文档说明）。

## 7. 截图与自动化 tab（P0-1 决策）

- `chrome.tabs.captureVisibleTab` **只能截窗口当前可见 tab**；自动化 tab 是 inactive。
- **决策**：自动化 tab 上截图时**直接报错**（复用 `TAB_NOT_ACTIVE`，消息提示“先激活该自动化 tab 再截图”），**不静默截错**。
- **激活路径（复用现有命令）**：`plt tabs`（默认列 session 的 tab）→ 拿到自动化 tab id → `plt tab <id>`（= `activate-tab`）→ 重试截图。会短暂把该 tab 带到前台（用户可感知，文档说明）。
- 修复现有缺陷：无 selector 的截图当前**不校验 active**，会截到用户 tab —— 一并改为校验并报错。

## 8. CLI / 协议面

- 全局：`--session <id|name>`、`--browser <id|label>`、`--tab <id|active>`。
- `plt session new [--name X] [--browser B]` / `list` / `use` / `close [--close-tab]`。
- `plt tabs [--all]`：默认只列当前 session 的 tab。
- `goto` 不再隐式绑定 tab；仅确保默认 session + 其自动化 tab。

## 9. 错误码（新增/调整）

- `AMBIGUOUS_BROWSER`（新增）：多浏览器且未指定。
- `BROWSER_NOT_FOUND`（新增）：`--browser` 未匹配（已知但离线用 `EXTENSION_OFFLINE`）。
- 复用：`SESSION_NOT_FOUND`、`EXTENSION_OFFLINE`、`TIMEOUT`、`TARGET_NOT_FOUND`、`TAB_NOT_ACTIVE`（截图需先激活）。
- 所有错误 `data` 带 `browserId`；`SESSION_TAB_CLOSED` 语义重审（不再有 session↔tab 绑定）。

## 10. 迁移

- `sessions.json` 去 `tabId`；`defaultSessionId` → `defaultSessionByBrowser`。
- 旧数据无 `browserId`：单连接时归入首个连接的 browser；否则标记为孤儿 session（`list` 可见、不可寻址）。
- 清理历史泄漏的 414 条无效 session（提供 `plt session prune` 或一次性迁移脚本）。

## 11. 安全说明

- 共享 profile：自动化 tab 与用户共享登录态 → 能访问用户已登录站点；使用文档与权限理由需说明。
- `browserId` **不是安全边界**；token 仍是全局唯一凭据。
- 长期存活的自动化 tab + 无鉴权 HTTP → 本机任意进程可持续驱动已登录浏览器（既有风险，见 `docs/TODO.md` 的 security future plan）。
- `eval` 默认禁用保持。

## 12. 建议增量（待 challenge 后细化）

```
0 Protocol/errors（Browser、Session 去 tabId、browserId、AMBIGUOUS_BROWSER）
1 ExtensionHub 多连接 + hello(instanceId,label)
2 扩展自动化 tab 管理器（get/create + storage.session + 标记找回 + onRemoved）
3 Server SessionRegistry 重写（去 tabId、每浏览器默认、session FIFO 队列、迁移）
4 Router 寻址重写 + browser 路由 + 截图 active 校验修复
5 CLI（--browser/--tab、session 命令、tabs 作用域）
6 文档 + 测试 + E2E（多浏览器、后台 tab 复用/找回、截图报错）
```

## 13. 决策记录

| #   | 决策                                                   | 来源           |
| --- | ------------------------------------------------------ | -------------- |
| 1   | Session = 浏览器上下文，共享登录态，无隔离             | 用户           |
| 2   | 每 session 专属后台 tab（inactive+pin）                | 用户           |
| 3   | `--tab` 临时操作用户 tab，不并入                       | 用户           |
| 4   | 多浏览器本期支持；多连接未指定 → `AMBIGUOUS_BROWSER`   | 用户           |
| 5   | 跨 session 并行；同 session FIFO 串行（无界 + 超时）   | 用户           |
| 6   | `session close` 默认保留自动化 tab，`--close-tab` 才关 | 用户           |
| 7   | id + name；每浏览器一个默认 session                    | 用户           |
| 8   | 后台 tab 截图 → 报错提示先激活（不静默截错）           | challenge P0-1 |
| 9   | 自动化 tab 映射 storage.session + 标记找回             | challenge P0-2 |
| 10  | browserId 全网透传                                     | challenge P0-3 |
| 11  | 同 session 队列：无界 FIFO + 每命令超时                | challenge P0-4 |
