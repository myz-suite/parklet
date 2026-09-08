# ParkingLot 协议参考（v0.1.0）

> 权威命令参考，供 `parkinglot` skill 与两端实现引用。
> 归属：`skills/parkinglot/references/protocol.md`（`docs/protocol.md` 为指向本文件的符号链接）。
> 实现位置：`packages/protocol`（`@parkinglot/protocol`，文中路径相对仓库根）。

协议仿 CDP/Playwright 心智模型：JSON-RPC 风格信封（`id/method/params` → `id/result|error`），扁平 kebab-case 命令名（与 CLI 子命令一一对应）。

## 传输层

| 链路               | 传输                                          | 说明                   |
| ------------------ | --------------------------------------------- | ---------------------- |
| extension ↔ server | WebSocket（`127.0.0.1`，token 配对）          | 文本帧，JSON 编码      |
| Agent ↔ server     | CLI 子进程（默认）或 HTTP `POST /api/command` | 同一套信封，无传输差异 |

编码一律 UTF-8 JSON；消息大小上限 10MB（超出报 `MESSAGE_TOO_LARGE`）；命令默认超时 30s（`TIMEOUT`）。

## 消息信封

### Request（命令）

```json
{ "id": "cli-1", "method": "goto", "params": { "url": "https://example.com" } }
```

### Response（成功）

`result` 的三个公共字段统一携带寻址与连续性信息，`data` 存放命令特有结果：

```json
{
  "id": "cli-1",
  "result": {
    "sessionId": "pl-01HK…",
    "tabId": 7,
    "context": { "url": "https://example.com", "title": "Example", "navId": 2, "tabId": 7 },
    "data": {}
  }
}
```

### Response（失败）

```json
{ "id": "cli-1", "error": { "code": "TIMEOUT", "message": "command timed out after 30000ms" } }
```

### Event（extension → server）

```json
{ "event": "page.navigated", "params": { "tabId": 7, "url": "https://example.com" } }
```

## 寻址与连续性（session / tab / navId）

命令 `params` 中可选寻址字段，按优先级：

1. `params.sessionId` — 显式指定逻辑会话
2. `params.tabId` — 显式指定物理标签页
3. （缺省）server 的默认 session（持久化于 state file）
4. 兜底：最近活跃 tab；无可用 tab 时返回 `EXTENSION_NO_TAB`

**连续性自证规则**：每次响应的 `context` 快照是 Agent 判断"页面是否变化"的唯一事实来源——

- `url` / `title` 变化 → 页面跳转了
- `navId` 递增 → 发生了导航（`goto`/`back`/`forward`/`reload`）
- `tabId` 变化 → 焦点被切走

CLI 侧 session 心智模型：

```
pl goto <url>          # 无 session → 自动创建并记住；响应带 sessionId/tabId/context
pl click "Submit"      # 默认作用于上次 session
pl session list|use|new|close
```

## 命令全集

写操作标记供 HITL 使用：`always`=需批准；`never`=只读；`conditional`=视参数。

### 导航

| 命令      | 参数                                                           | 返回 data           | 写     |
| --------- | -------------------------------------------------------------- | ------------------- | ------ |
| `goto`    | `url`（http/https）、`waitUntil?`（`load`/`domcontentloaded`） | —（产物即 context） | always |
| `back`    | —                                                              | —                   | always |
| `forward` | —                                                              | —                   | always |
| `reload`  | —                                                              | —                   | always |

### 交互

| 命令         | 参数                                      | 返回 data                  | 写     |
| ------------ | ----------------------------------------- | -------------------------- | ------ |
| `click`      | `selector`（CSS）                         | `{ element: ElementInfo }` | always |
| `click-text` | `text`（可见文本，模糊匹配+去重）         | `{ element }`              | always |
| `fill`       | `selector`, `value`（整体替换）           | `{ element }`              | always |
| `type`       | `selector`, `text`（逐键）                | `{ element }`              | always |
| `press`      | `selector?`, `key`                        | `{ element }`              | always |
| `hover`      | `selector`                                | `{ element }`              | always |
| `select`     | `selector`, `value?`/`label?`（至少其一） | `{ element }`              | always |

### 滚动 / 视图

| 命令         | 参数                                                                   | 返回 data                  | 写     |
| ------------ | ---------------------------------------------------------------------- | -------------------------- | ------ |
| `scroll`     | `direction?`（up/down/top/bottom）、`amount?`、`selector?`（至少其一） | `{ viewport }`             | always |
| `screenshot` | `format?`（png/jpeg）、`fullPage?`、`path?`                            | `{ data?: base64, path? }` | never  |

### 提取

| 命令            | 参数                                             | 返回 data                                                 | 写    |
| --------------- | ------------------------------------------------ | --------------------------------------------------------- | ----- |
| `extract`       | `mode?`（text/structured）、`limit?`（字符裁剪） | `{ snapshot: PageSnapshot }`（可见文本+viewport+scrollY） | never |
| `get-page-info` | —                                                | `{ url, title, viewport, scrollY }`                       | never |

### 页面内网络（在真实页面上下文执行，带登录态）

| 命令     | 参数                                                 | 返回 data                                 | 写          |
| -------- | ---------------------------------------------------- | ----------------------------------------- | ----------- |
| `fetch`  | `url`、`method?`、`headers?`、`body?`、`returnType?` | `{ status, statusText?, headers, body }`  | conditional |
| `search` | `query`、`engine?`                                   | `{ results: [{ title, url, snippet? }] }` | never       |

### 标签页

| 命令           | 参数     | 返回 data             | 写     |
| -------------- | -------- | --------------------- | ------ |
| `list-tabs`    | —        | `{ tabs: TabInfo[] }` | never  |
| `create-tab`   | `url`    | `{ tab }`             | always |
| `close-tab`    | `tabId?` | —                     | always |
| `activate-tab` | `tabId`  | `{ tab }`             | always |

### 等待

| 命令   | 参数                                                                         | 返回 data | 写    |
| ------ | ---------------------------------------------------------------------------- | --------- | ----- |
| `wait` | `ms?`、`selector?`（等到可见）、`condition?`（networkidle/load）（至少其一） | —         | never |

### 会话

| 命令         | 参数 | 返回 data                                       | 写    |
| ------------ | ---- | ----------------------------------------------- | ----- |
| `ping`       | —    | `{ pong, protocolVersion, extensionConnected }` | never |
| `get-status` | —    | `{ extensionConnected, sessions, config }`      | never |

### 高级（默认禁用）

| 命令   | 参数         | 返回 data   | 写     |
| ------ | ------------ | ----------- | ------ |
| `eval` | `expression` | `{ value }` | always |

`eval` 需 `PARKINGLOT_ENABLE_EVAL=1` + session `mode: trust`，否则 `EVAL_DISABLED`。

## 事件（v1 最小集）

| 事件                                             | 方向               | 触发                 | 用途                              |
| ------------------------------------------------ | ------------------ | -------------------- | --------------------------------- |
| `extension.connected` / `extension.disconnected` | server → extension | 扩展 WS 状态变化     | 日志、status                      |
| `extension.tab-activated`                        | extension → server | 激活标签页           | server 维护"最近活跃 tab"兜底寻址 |
| `page.navigated`                                 | extension → server | 主框架导航完成       | 审计、（未来）推送长驻 Agent      |
| `approval.requested`                             | server → extension | 写操作进入 HITL 挂起 | popup 批准队列                    |
| `approval.respond`                               | extension → server | popup 批准/拒绝      | server 回写 ApprovalManager       |
| `approval.responded`                             | （保留）           | HITL 状态变化        | 未来事件流                        |

`Network.*` 为扩展点：v1 不实现页面级网络事件。

## 错误码

| code                                                                          | 含义                                   |
| ----------------------------------------------------------------------------- | -------------------------------------- |
| `INVALID_REQUEST` / `INVALID_PARAMS` / `UNKNOWN_METHOD` / `MESSAGE_TOO_LARGE` | 信封/参数校验失败                      |
| `EXTENSION_OFFLINE` / `EXTENSION_NO_TAB`                                      | 扩展未连接 / 无可操作 tab              |
| `SESSION_NOT_FOUND` / `SESSION_TAB_CLOSED`                                    | session 不存在 / session 的 tab 已关闭 |
| `TIMEOUT`                                                                     | 命令超时（默认 30s）                   |
| `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`                                       | 定位器找不到 / 匹配多个元素            |
| `URL_INVALID` / `HOST_NOT_ALLOWED`                                            | URL 非法 / 域名不在白名单              |
| `EVAL_DISABLED`                                                               | eval 未开启                            |
| `PENDING_APPROVAL` / `APPROVAL_DENIED` / `APPROVAL_TIMEOUT`                   | HITL：待批准 / 拒绝 / 超时             |
| `INTERNAL`                                                                    | 兜底错误                               |

## 校验原则（Postel's Law）

- **发送保守**：schema 精确到每个命令的参数形状（`packages/protocol/src/schemas.ts`）。
- **接收宽容**：未知字段 strip；缺省字段用 optional；`validateParams(method, params)` 返回规范化参数。
- 两端（server Router 与 extension）必须用同一套 schema。

## 公共类型

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
  viewport: Viewport;
  scrollY: number;
}
interface ElementInfo {
  tag: string;
  text?: string;
  attrs: Record<string, string>;
  box?: { x; y; width; height };
}
interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}
interface SessionInfo {
  id: string;
  tabId?: number;
  mode: 'auto' | 'ask';
  createdAt: string;
  lastUsedAt: string;
}
interface Viewport {
  width: number;
  height: number;
}
```
