# v2 Incremental Plan — Community-Driven Improvements

批准日期：2026-09-11
状态：**已完成并验证**（7 个增量全部落地；执行记录与偏差见文末）
关联文档：`docs/protocol.md`（协议参考，symlink 至 `skills/parklet/references/protocol.md`）

## 背景

v1 的全部阶段已完成并通过验证。本次 v2 从实际使用中暴露的问题出发，做一轮体验与能力提升。所有决策已在对话中确认，并完成 review + challenge 修订。

## 决策总览

| #   | 主题               | 决策                                                                                                                                                                               |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tab 关闭 → session | 自动回退到 latestTab（双保险：onRemoved 事件 + server 命令失败防御回退）                                                                                                           |
| 2   | HITL               | 完全删除（approval 相关代码、`ask` mode、`approve`/`deny` CLI、popup UI、E2E 测试）                                                                                                |
| 3   | Extract            | 加 `selector`；`mode: text` 返回文本，`mode: structured` 返回 DOM 树 JSON（单行，可选 `prettify`）；加 `depth`/`limit`/`offset`/`visibleOnly`；`article` flag 用 defuddle 提取主体 |
| 4   | Screenshot         | 加 `selector`；元素不在 viewport → 先滚动再截，过大直接截可见部分；**目标 tab 非 active → 报错 `TAB_NOT_ACTIVE`**                                                                  |
| 5   | 主体提取           | extension 侧 defuddle（browser bundle），作为 `extract --article` 实现                                                                                                             |
| 6   | Fill/Type 智能解析 | selector 指向非 input 时自动找 input（label[for] > 第一个可聚焦 input > 后代首个 > 否则 `TARGET_AMBIGUOUS`）；fill 设 value，type 逐 keystroke                                     |
| 7   | Press 组合键       | Playwright 风格（`Control+c`、`Meta+s`、`Shift+Tab`）；完整事件序列（修饰键 keydown → 主键 keydown/keypress/keyup → 修饰键 keyup）                                                 |
| 8   | 新窗口/Tab         | 服务器缓存事件（`tab.created` 含 windowId、`tab.removed`），CLI 输出未读数，`plt events` 拉取后清空                                                                                |
| 9   | 非 Active Tab      | 已支持，无需改动（screenshot 例外，见上）                                                                                                                                          |
| 10  | DOM 查询           | ~~新增 query-dom 命令~~ **取消**：折叠进 `extract` structured 模式（depth 默认 3 不设上限 + limit/offset + visibleOnly + 总节点数预算）                                            |
| 11  | CLI 入口           | 修复 `import.meta.url` vs symlink `argv[1]` 不匹配；无单元测试导入 cli.ts，直接删除守卫                                                                                            |

约束：产品未正式发布，**PROTOCOL_VERSION（0.1.0）不提升**。

## Challenge 修订记录（2026-09-11）

review + challenge 后落实的修订（`### 用户 review 修订（2026-09-11）` 一节的补充）：

1. **回退双保险**：仅靠 `tabs.onRemoved` 不可靠（MV3 SW 可能休眠错过事件）。server 在命令针对 session 失败（tab 失效类错误）时也做防御性回退。
2. **screenshot selector 后台 tab**：`captureVisibleTab` 只截可见 tab，非 active 目标 tab 行为未定义 → 报错。裁剪需处理 **devicePixelRatio**（`getBoundingClientRect` = CSS 像素 vs 截图 bitmap = DPR 缩放）。
3. **query-dom 折叠进 extract**：structured 结果即 DOM 树（`DomNode[]`），避免两个命令职责重叠。
4. **extract 结果 = 按 `mode` 判别联合**，下游按 `mode` 分支。
5. **文档对齐**：`protocol.md`、`initial-plan.md`、`AGENTS.md` 均描述 HITL/旧 extract，作废于本次改动，需收尾对齐。
6. **HITL 删除范围扩充**：≈14 个文件 + E2E + docs（config/env、router/config 测试、popup UI、shared/messages、ws/server 注释）。
7. **extract structured 总量预算**：depth 无上限导致树可能超 WS 消息上限 → 加 `maxNodes`（默认 500）总节点预算。
8. **press 完整序列**：见决策表 #7。
9. **defuddle 打包**：静态 top-level import（MV3 content script 动态 import 不可靠）；review 后确认构建工具为 **esbuild**（`build.config.mjs:5`），打包确认见 Increment 4d。
10. **多 session 回退碰撞**：回退语义 = 全局最近激活 tab（非 session 自身最后使用 tab），在文档中写明。
11. **tab.created 含 windowId**：区分 popup 窗口与普通 tab。
12. **extract 的 `limit` 语义按 mode 区分**：text 模式 = 字符截断（延续 v1）；structured 模式 = 第一层元素数上限 + `offset` 分页。_（执行前被参数语义章节的最终决定取代，见下）_

## 用户 review 修订（2026-09-11）

用户在最终 review 中对照真实代码核实提出的修正，已全部落实：

- **高优先级**
  1. **文档对齐范围补全**：除 `protocol.md`/`initial-plan.md`/`AGENTS.md` 外，`skills/parklet/SKILL.md`（`:32` 命令表、`:53` 事件表含 approve/ask）、`skills/parklet/references/protocol.zh.md`、`packages/extension/popup.html` + `popup.css`、`packages/server/package.json` + `packages/extension/package.json` description 也宣传 HITL → 全部纳入 Increment 7 清单（各带行号）。
  2. **symlink 关系**：`docs/protocol.md` 是 `skills/parklet/references/protocol.md` 的 symlink（同一文件），`.agents/skills/parklet` 是对 `../../skills/parklet` 的目录 symlink → **文档对齐只改主文件 `skills/parklet/references/protocol.md`（+ 中文版 `protocol.zh.md`），不再列 `.agents` 副本**，避免误改出两个版本。
  3. **Increment 3 回退语义**：`resolve()`（`session.ts:127`）是**同步**函数，不调用扩展，无法在 resolve 时得知"extension 报 tab 类错误"；`tab.removed` → `unbindTab` 置 `tabId=undefined`（`:136-138`）；`resolve()` 遇 `undefined` 不再抛 `SESSION_TAB_CLOSED`，改为回退 `latestTabId` 并重绑；**回退到全局最近激活 tab（`hub.latestTabId`，仅由 `tab-activated` 更新）**。
  4. **tab 失效错误码**：`chrome.tabs.get` 抛 "No tab with id" 目前被 `background.ts:208` 包成 `INTERNAL`，识别不可靠 → 扩展 dispatch 层直接映射为稳定码 `SESSION_TAB_CLOSED`（语义 ="目标 tab 已不存在"），server 据此触发防御性 `unbindTab`，**失败命令不重试**（仅影响后续）。
  5. **defuddle 构建工具**：扩展用 **esbuild**（`build.config.mjs:5`，format iife、target chrome120），非 vite → 打包确认改写为 esbuild 路径，评估 content script 体积。
- **中优先级** 6. **ExtractResult 判别联合不一致**：`ExtractParams.mode` 仅 `'text'|'structured'`，但结果联合含 `mode:'article'`（由 `article?: boolean` 触发）→ 判别字段明确为结果内 `mode`，并补 `.refine` 在 schema 层强制 `article` 与 `mode` 互斥；下游用 `texts` 存在性区分整页/分段。7. **screenshot 滚动路径**：`actions.ts:120` 用 `behavior:'smooth'`，截图需 **instant** 独立路径（避免截到滚动中间帧）；rect × DPR 后 **clamp 到 viewport/图像边界**；`tab.active=true` ≠ 窗口 focused，确认目标 tab 为其所属窗口 active（`captureVisibleTab` 语义）。8. **Increment 3 与 5 的 `tab.removed` 重复实现**：监听注册只放 Increment 5，Increment 3 只消费。9. **HITL 删除遗漏**：`ledger.ts:4` `LedgerOutcome` 含 `'pending'|'approved'|'denied'|'timeout'`；`router.ts:342` `get-status` config 暴露 `approvalTimeoutMs`；`router.test.ts` `RouterDeps` 含 approval 注入；E2E helper 实际名为 `sessionMode`/`firstPendingRequestId`/`respondApproval`（非 plan 原写的 `waitApproval`/`approveFlow`）→ 已在 Increment 2 补全/更正。10. **未读数 wire 变更风险**：命令响应附加未读数 = 未升版本的 wire 变更；`commandResultSchema`（`schemas.ts:154`）strip 未知顶层字段，但非测试代码不校验响应，CLI 侧可行 → 显式记录并接受风险（预发布，旧扩展/CLI 混用丢未读数）。
- **低优先级** 11. Increment 1 原把 `types.ts` 列了两次 → 已合并。12. `index.ts:70` 同款 `import.meta.url` 守卫**不改**（`node dist/index.js` 直启无 symlink，逻辑正确；被 `serve` import 复用）。13. `tab.created` 只发事件、**不更新 `hub.latestTabId`**（`ws/server.ts:163` 只处理 `tab-activated`）→ 保持现状（新 tab 创建≠用户切到它），已在 Increment 5 注明。14. **依赖图语义**：明确 Increment 6 只依赖 4/5（不依赖 2/3），图例已改。

## 参数语义（2026-09-11 第二次确认）

- **offset / limit**：作用于**第一层列表**的元素切片 —— 多 root（selector 匹配多个）时切 roots 列表；单 root 时切该 root 的**子元素**列表。
- **depth**：相对 root 的递归深度，**不含 root**。depth=1 = root + 1 层子级；默认 3 = root + 3 层。子节点数量不限，用全局 `maxNodes=500` 预算兜底；超限时**按广度优先（前序 per-level）截断**并带 `truncated: true`，优先保留高层的整体结构。
- **文本截断拆参**：text 模式字符截断用新增 `maxChars`（替代 v1 `limit` 的角色；CLI `--limit <chars>` 改为 `--max-chars`）。**`maxChars` 不传 = 不截断（返回完整文本，延续 v1 `limit` 缺省行为）**。`limit` 恒为元素计数。
- **visibleOnly**：过滤第一层列表（roots 或单 root 的子元素）中不可见元素；子树照常保留结构。
- **prettify**：CLI 独有展示选项，不进 wire 协议。

## 增量顺序

```
1 (Protocol) → 2 (HITL) → 3 (Session)
                 ↓
1 (Protocol) → 4 (Commands) → 5 (Events) → 6 (CLI) → 7 (Docs) → E2E
```

- Increment 1 是所有后续的基础
- Increment 2（删 HITL）→ 3（session 回退）**顺序执行**：两者都改 `session.ts`（2 删 mode 字段/方法，3 加 unbindTab），并行会冲突
- Increment 4 / 5 依赖 1
- **Increment 6 只依赖 4 和 5**（即 1→4→5→6；不依赖 2/3 —— 2/3 是 server 内部行为，CLI 不感知，图例为 `4→5` 一线）
- Increment 7（文档对齐）依赖所有代码增量

### Increment 1: Protocol 层更新

**变更**

- `packages/protocol/src/types.ts`：新增 `DomNode { tag, attrs, text?, children }`
- `packages/protocol/src/errors.ts`：新增 `'TAB_NOT_ACTIVE'`；移除 HITL 错误码（`PENDING_APPROVAL`/`APPROVAL_DENIED`/`APPROVAL_TIMEOUT`）
- `packages/protocol/src/methods.ts`
  - METHODS 不变（不新增 query-dom / extract-article）
  - METHOD_META 更新 extract/screenshot/press/fill/type 文案
  - 更新 `ExtractParams`：
    ```ts
    interface ExtractParams {
      mode?: 'text' | 'structured'; // 默认 'text'
      article?: boolean; // true → defuddle 文章模式；与 mode 互斥；selector 同时传入时作为 contentSelector
      selector?: string; // 提供 → 按 CSS 匹配；缺省 → 整页（text）/ body（structured）/ article 自动检测
      offset?: number; // 第一层列表跳过前 N 个（多 root=roots；单 root=其子元素）
      limit?: number; // 第一层列表最多 N 个（元素计数，恒语义一致）
      depth?: number; // 相对 root 递归深度，不含 root；默认 3
      visibleOnly?: boolean; // 过滤第一层列表中不可见元素
      maxChars?: number; // text 模式每段文本字符截断（替代 v1 limit 角色）
    }
    ```
  - 更新 `ScreenshotParams`：新增 `selector?`
  - ResultMap（extract 改为判别联合；**判别字段 = 结果内 `mode`**，与 params.mode 独立）：
    ```ts
    type ExtractResult =
      | { mode: 'text'; snapshot: PageSnapshot } // 无 selector，整页
      | { mode: 'text'; texts: string[] } // 有 selector，每个匹配元素文本
      | { mode: 'structured'; nodes: DomNode[]; truncated?: boolean } // DOM 树
      | { mode: 'article'; content: string; title?; author?; site?; wordCount? };
    ```
    下游判别规则：结果 `mode` 为最终判别符（`'article'` 由 params.article=true 触发，与 params.mode 无关）；`mode:'text'` 再用 `texts` 存在性区分整页/分段。
- `packages/protocol/src/schemas.ts`：更新 extract/screenshot Zod schema（参照参数语义章节）；**extract schema 加 `.refine`：`article` 与 `mode` 二者不可同时提供**（互斥在 schema 层强制，不只是注释）
- `packages/protocol/src/envelope.ts`：EVENT_NAMES 新增 `'tab.created'`、`'tab.removed'`；移除 `'approval.requested'`/`'approval.responded'`/`'approval.respond'`

**验证**：`pnpm --filter @parklet/protocol typecheck` + `pnpm --filter @parklet/protocol test`

### Increment 2: 删除 HITL（范围已扩充）

**变更**

- 删除：`packages/server/src/approval.ts` + `approval.test.ts`
- `packages/server/src/ledger.ts`：`LedgerOutcome` 移除 `'pending'|'approved'|'denied'|'timeout'`（`:4`，仅留 ok/error）
- `packages/server/src/config.ts`：移除 `approvalTimeoutMs` + `PARKLET_APPROVAL_TIMEOUT_MS` 环境变量读取；`config.test.ts` 同步
- `packages/server/src/router.ts`：移除 HITL 挂起分支（`mode === 'ask'`）+ `get-status` config 中 `approvalTimeoutMs` 暴露（`:342`）；`router.test.ts` 删除 HITL 测试，`RouterDeps` 重构（移除 `approval` 注入）
- `packages/server/src/session.ts`：Session 移除 `mode` 字段 + `setMode()` 方法 + `create()` 的 `mode` 选项；关联的 `session.test.ts`（mode 相关断言）同步
- `packages/server/src/http.ts`：移除 `POST /api/approve/:requestId`、`pendingApprovals`、`approvalTimeoutMs` 状态；session create 不再传 mode（:148）
- `packages/protocol/src/types.ts` + `runtime.ts`：删除 `SessionMode` 类型及 re-export；`SessionInfo.mode` 移除
- `packages/server/src/index.ts`：移除 `approval.respond` 事件处理 + ApprovalManager 实例
- `packages/extension/src/popup.ts`：移除 approval UI + 轮询
- `packages/extension/src/background.ts`：移除 approval 事件处理与转发
- `packages/extension/src/shared/messages.ts`：移除 approvals 消息类型
- `packages/server/src/ws/server.ts`：更新 HITL 相关注释
- `packages/extension/popup.html` + `popup.css`：移除 approval 区域（`#approvals`、`#approval-list`、`#approvals-empty`）
- `tests/e2e/parklet.e2e.spec.ts`：移除 HITL 测试 + helpers（实际名：`sessionMode`（:134）、`firstPendingRequestId`（:148）、`respondApproval`（:162））
- `packages/protocol/src/methods.ts`：`METHOD_META` 保留 `writeAccess` 字段（供审计/日志），`methods.test.ts` 的 HITL 分类测试标题改为「classifies write access for each method」
- 文档占位：`protocol.md` 中 HITL 章节标记待删（正式移除在 Increment 7）

**验证**：`pnpm typecheck` + `pnpm test` + `pnpm lint`

### Increment 3: Session Tab 关闭自动回退（双保险）

**回退语义精确定义（review 修订）**

`resolve()`（`session.ts:127`）是**同步**函数、不调用扩展，无法在 resolve 时得知"extension 报 tab 类错误"。真实链路：

1. **主动路径**：`tab.removed` 事件 → server 调 `unbindTab(tabId)` → 所有绑定该 tabId 的 session `tabId=undefined`
2. **resolve 回退**：`resolve()` 遇 `s.tabId === undefined` 时**不再抛 `SESSION_TAB_CLOSED`**（当前 `:137`），改为回退到 `latestTabId` 并返回 `{ sessionId, tabId: latestTabId }`（同时 `touch(id, { tabId })` 重绑）。**若 `latestTabId` 也未定义**（尚无 `tab-activated`）→ 抛 `EXTENSION_NO_TAB`（与默认 session 分支 `session.ts:157` 一致），避免返回 `tabId: undefined` 的非法 target
3. **防御路径**：命令执行返回 tab 失效类错误 → `unbindTab(sessionId)` 清绑定，**对本次失败命令不重试**（仅影响后续命令，避免重复副作用）
4. 回退优先级落在 `resolve()` 的既有 `latestTabId` 分支上：显式 `params.sessionId` 仍优先，其次才是回退

**tab 失效错误码映射（review 修订）**

`chrome.tabs.get` 抛出的 "No tab with id" 目前被 `background.ts:208` 包成 `INTERNAL`。靠 `INTERNAL` + message 关键词识别不可靠，改为：扩展在 dispatch 层把 `chrome.tabs.get` 的 tab 不存在错误**直接映射为稳定错误码 `SESSION_TAB_CLOSED`**（复用现有码，语义 = "目标 tab 已不存在"），server 据此触发防御性 `unbindTab`。`TAB_NOT_ACTIVE` 不触发回退。

**变更**

- `packages/extension/src/background.ts`：`chrome.tabs.onRemoved` 的监听/发射统一放 Increment 5（**Increment 3 只实现 server 侧的消费，不注册监听**；故 Increment 3 完成时"主动路径"暂不可用，仅防御路径生效，主动路径待 Increment 5 接通）；映射 tab 失效错误为 `SESSION_TAB_CLOSED`
- `packages/server/src/session.ts`
  - `resolve()`：`s.tabId === undefined` 不再抛错 → 回退 `latestTabId` 并重绑（修改 `:136-138`）
  - 新增 `unbindTab(tabId)`：清除所有绑定该 tabId 的 session
- server 收到 `tab.removed`（Increment 5 事件）→ 调 `unbindTab(tabId)`
- server 命令失败且错误为 `SESSION_TAB_CLOSED` → 防御性 `unbindTab` + 不重试
- 回退语义补充：**回退到全局最近激活 tab（`hub.latestTabId`，仅由 `tab-activated` 更新）**，非 session 自身最后使用

**验证**：`pnpm typecheck` + `pnpm test`（新增 tab 关闭场景单元测试）

### Increment 4: 命令更新（核心功能）

**4a. Fill/Type 智能解析** — `packages/extension/src/dom/actions.ts`

```
resolveInput(doc, selector):
  1. el = querySelector(selector)
  2. el 是 input/textarea/[contenteditable] → 返回
  3. el 是 label → label.htmlFor 匹配 #id，否则 label 内首个 input/textarea
  4. 向上找最近 label/fieldset：label.htmlFor → else 其中首个可聚焦 input
  5. 搜索 el 后代首个 input/textarea/[contenteditable]
  6. 多候选且无 label[for] 精确匹配 → TARGET_AMBIGUOUS
  7. 无 → TARGET_NOT_FOUND
```

- `fill`：先 `resolveInput()` 再设 value + fire input/change
- `type`：先 `resolveInput()` 再 focus + 逐字符（keydown/keypress/input）

**4b. Press 组合键** — `packages/extension/src/dom/actions.ts`

```
parseKeyCombo("Control+c") → { key: 'c', modifiers: { ctrl, shift, alt, meta } }
```

完整事件序列：modifier keydown → 主键 keydown/keypress/keyup → modifier keyup（每个带正确的 modifier 标志）。

**4c. Screenshot selector** — `packages/extension/src/background.ts` + content script

- 有 selector：content script 返回元素 rect（**含 devicePixelRatio**）与 `tab.active`
- 目标 tab 非 active → 抛 `TAB_NOT_ACTIVE`（不自动激活，不打扰用户）
- 元素不在 viewport → `scrollIntoView({ behavior: 'instant', block: 'center' })` 滚动后再取 rect（**不可用 `actions.ts:120` 的 `behavior:'smooth'`，否则截到滚动中间帧**，需独立 instant 滚动路径）
- `captureVisibleTab` → 按 rect × DPR 裁剪；**对裁剪区 clamp 到 viewport 与图像边界**（处理浏览器缩放/超视口）
- 元素超出 viewport：截可见部分，不拼接
- **注意**：`tab.active=true` 不等于窗口 focused；`captureVisibleTab` 截的是窗口当前可见 tab，截图前确认目标 tab 为其窗口的 active tab

**4d. Extract text/structured/article** — `packages/extension/src/dom/snapshot.ts` + `actions.ts`

- text 无 selector → v1 `buildPageSnapshot`（形状：`{ snapshot }`，文本按 `maxChars` 截断）
- text + selector → `querySelectorAll` → 第一层列表按 `offset`/`limit` 切片 → 每个匹配元素取 visibleText（每段按 `maxChars` 截断）→ `texts: string[]`
- structured → 第一层列表按 `offset`/`limit` 切片（多 root 切 roots；单 root 切其子元素）→ 每个 root 递归构建 `DomNode[]`：
  - `depth` 不含 root，默认 3，不设上限
  - `visibleOnly` 过滤第一层列表中不可见元素（子树照常）
  - **总节点预算 `maxNodes`=500**（**固定常量，不进 `ExtractParams`/schema**），超限截断并设 `truncated: true`
- article → defuddle `new Defuddle(document, { contentSelector, markdown: true }).parse()`，`contentSelector` = `params.selector`（未提供则靠自动检测）；**静态 top-level import**（MV3 content script 动态 import 不可靠）；需先 `pnpm --filter @parklet/extension add defuddle`
- **打包确认（review 修订）**：扩展构建是 **esbuild**（`build.config.mjs:5`，format iife、target chrome120），非 vite。确认 esbuild 将 defuddle（core bundle，无依赖）打进 content.js chunk，并评估 content script 体积增量

**验证**：`pnpm typecheck` + `pnpm test`（新增对应单元测试）

### Increment 5: 事件系统

**变更**

- `packages/extension/src/background.ts`：`chrome.tabs.onCreated` → 发 `tab.created`（tabId/**windowId**/url/title）；**`chrome.tabs.onRemoved` 监听在此统一注册发射**（Increment 3 只消费，不重复注册）→ 发 `tab.removed`（tabId）
- **`tab.created` 不更新 `hub.latestTabId`**（`ws/server.ts:163` 目前只处理 `tab-activated`）：新 tab 创建≠用户主动切到它，回退目标仍为"最近激活"，保持现状 `onActivated` 更新即可
- `packages/server/src/event-cache.ts`（新文件）：内存缓存最近 100 条，`push/drain/unreadCount`
- `packages/server/src/index.ts`：WS 收事件 → 入缓存
- HTTP API：`GET /api/events` → `{ events, unreadCount }`，拉取后未读数清零
- server 的 **HTTP** 命令响应附带服务端未读数（供 CLI 展示；WS 响应发往 extension，无此需要）
- **wire 变更风险记录**：命令响应附加未读数是未升版本的 wire 变更；`commandResultSchema`（`schemas.ts:154`）会 strip 未知顶层字段，但非测试代码目前不校验响应，CLI 侧可行。**显式接受风险**（预发布，旧扩展/CLI 混用会丢未读数/新事件）

**验证**：`pnpm typecheck` + `pnpm test`

### Increment 6: CLI 更新

**变更** — `packages/server/src/cli.ts`

- **入口修复**：删除 cli.ts 的 `import.meta.url.endsWith(process.argv[1]...)` 守卫，直接 `buildProgram()` + `parseAsync`；**`index.ts:70` 同款守卫不改** —— 它服务于 `node dist/index.js` 直启（无 symlink，守卫逻辑正确），且被 `serve` 经 import 复用
- 新增 `plt events [--tail N]`（展示 + 清空未读）
- 更新 `plt extract`：`--selector <css>`、`--prettify`、`--article`、`--depth <n>`、`--offset <n>`、`--limit <n>`、`--max-chars <n>`、`--visible-only`
- 更新 `plt screenshot`：`--selector <css>`
- 更新 `plt press` 帮助文本（Playwright 格式示例）
- 删除 `plt approve` / `plt deny`
- `plt session` 移除 `--mode` 与 `mode` action
- 移除 `get-status` 打印（`cli.ts:180-186`）与 `session list`（`cli.ts:625`）中的 `mode` 输出（`SessionInfo.mode` 已删，弱类型 cast 不会被 typecheck 拦截）
- `exitCodeFor`（`cli.ts:121`）为 `TAB_NOT_ACTIVE` 指定退出码 3（与 `TARGET_NOT_FOUND` 同类）
- `printResult` 适配 extract 判别联合（text/texts/nodes/article）与 screenshot 错误码
- 全局命令成功输出后附加未读事件提醒：`N new events, run plt events`

**验证**：`pnpm typecheck` + `pnpm test` + 手动 `plt --help`

### Increment 7: 文档对齐（完整清单）

**symlink 说明（review 修订）**：`docs/protocol.md` 是指向 `skills/parklet/references/protocol.md` 的**符号链接**（symbolic link，二者是同一文件）；`.agents/skills/parklet` → `../../skills/parklet`（目录 symlink）。**只需改一处主文件 `skills/parklet/references/protocol.md`（= docs/protocol.md）+ 中文版 `protocol.zh.md`**，不再单独列 `.agents` 副本。

**对外主文档**

- `skills/parklet/references/protocol.md`（= `docs/protocol.md`，symlink 同一文件）：移除 HITL 章节；更新 extract/screenshot/press；补事件与错误码
- `skills/parklet/references/protocol.zh.md`：同步中文协议（HITL、extract 旧语义）
- `skills/parklet/SKILL.md`：移除 ask 模式指导 + `plt approve/deny`（`:32`）与 `PENDING_APPROVAL`（`:53`）指引
- `README.md`：移除 HITL 特性宣传（`:18` 特性列表、`:27` server role、`:131-133` CLI 表、`:152-160` ask 示例）
- `AGENTS.md`：server role 移除 HITL（`:11,18,45`）；Current status 更新
- `packages/extension/package.json` + `packages/server/package.json`：description 移除 HITL

**内部文档**

- `docs/initial-plan.md`：HITL 验收标准替换/移除；标记 v2 变更
- `docs/v2-incremental-plan.md`：执行后更新为完成版（含偏差记录）

**验证**：审阅一致性 + `git grep -nE "HITL|approv|\bdeny\b|\bask\b"` 应无遗留（除 docs/initial-plan.md 有意保留的历史标记；用词边界避免 `task`/`mask` 误报）

## 每增量完成后检查

```
pnpm typecheck && pnpm test && pnpm lint && pnpm format
```

## 最终验证

- 全量：`pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format`
- E2E：`pnpm test:e2e`（需删除 HITL 测试后通过）
- 手动：`plt --help` 命令列表确认

## 未决事项（后续可独立跟进）

- `plt events --follow` 长连接设计（本期只做拉取 + 未读数）
- 页面级网络事件（现有 Network.* 扩展点）
- `tab.updated`（导航事件）尚未纳入

## 执行记录与偏差（2026-09-11）

7 个增量全部落地；`pnpm typecheck` / `pnpm test`（130 用例）/ `pnpm build` / `pnpm lint` 全绿，`plt --help` 已核对。

| #   | 增量         | 结果                                                                                                                                                             |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Protocol 层  | DomNode、`TAB_NOT_ACTIVE`、`ExtractResult` 判别联合、extract/screenshot schema、`tab.created/removed` 事件、移除 HITL 错误码                                     |
| 2   | 删除 HITL    | 删除 `approval.ts`(+test)、config/router/session/http/index/ledger、popup/messages/background、popup.html/css、E2E；`SessionMode` 与 `SessionInfo.mode` 一并移除 |
| 3   | Session 回退 | `unbindTab` + `resolve()` 回退 `latestTabId`（无则 `EXTENSION_NO_TAB`）；扩展把 tab 失效映射为 `SESSION_TAB_CLOSED`；router 防御性解绑、不重试                   |
| 4   | 命令更新     | `resolveInput`、press 组合键、元素截图（instant 滚动 + DPR/缩放裁剪）、extract text/structured/article（defuddle）                                               |
| 5   | 事件系统     | `EventCache`（tab.created/removed）、`GET /api/events`、HTTP 命令响应附带 `unreadCount`                                                                          |
| 6   | CLI          | 入口守卫删除、`plt events`、extract/screenshot 新选项、press 帮助、移除 approve/deny 与 session mode；`TAB_NOT_ACTIVE` 退出码 3                                  |
| 7   | 文档         | protocol.md/zh、SKILL.md、README、AGENTS.md、两个 package.json description、initial-plan 标注                                                                    |

执行期偏差/补充：

1. **Increment 2 顺带移除了 CLI 的 HITL 残片**：`exitCodeFor` 引用了被删错误码会导致 typecheck 失败，故在 2 就删除了 `approve()/approve/deny/session --mode` 与 mode 打印（原计划放 Increment 6）。
2. **defuddle 默认导入**：该包以 CJS/UMD 发布（`module.exports = class`），NodeNext 下默认导入类型退化为命名空间，代码里用显式构造器类型收窄（`DomNodeModule as unknown as DefuddleConstructor`）。
3. **content script 体积**：esbuild 未 minify，含 defuddle 后 `content.js` ≈ 535KB（未压缩）。功能正常；如需可后续开 minify 或换 defuddle 精简入口。
4. **事件缓存范围**：只缓存 `tab.created`/`tab.removed`（避免 `page.navigated` 每次导航都刷"未读"）；未读数附在 HTTP 命令响应的 `result.unreadCount`。
5. **structured 单 root 语义**：`selector` 只匹配一个元素时，第一层列表取其子元素（按参数语义章节），故返回的是该元素子树的 `DomNode[]`。
6. **E2E**：HITL 用例与 helpers 已删除；`pnpm test:e2e` 已跑通（9 passed，含截图像素断言与 SW 保活）。本期未新增 E2E 用例覆盖 extract/press/tab 回退等新特性（已有单测覆盖）。
7. **后续文档调整（2026-09-14）**：移除 `skills/parklet/references/protocol.zh.md`（改为英文单版），并在 `references/` 下新增 `example.md` 作为参考示例；protocol.md/SKILL.md/README.md 同步更新。上文中"同步 protocol.zh.md"的条目已作废。
8. **版本约定调整（2026-09-14）**：上文 §"约束"的"PROTOCOL_VERSION（0.1.0）不提升"作废——`PROTOCOL_VERSION` 与 npm 包版本解耦，改为 **`0.1.0-draft`** 表示线协议仍在设计中；各 package（protocol/server/extension）npm 版本统一为 **0.2.0**。`plt --version` 显示包版本 + 协议版本。
