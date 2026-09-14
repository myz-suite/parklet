# Kimi 全量对话导出 — 实战日志

> 目的：用 ParkingLot（`plt`）把 kimi.com 的全部历史会话导出为每会话一个 JSON（含时间戳），
> 并记录本次实战中工具的能力、缺陷与改进点。这是改进 ParkingLot 的一手案例材料。

## 1. 用户需求

- 导出 kimi.com 上**全部历史会话**（当前约 252 个）。
- 每个会话保存成**一个 JSON 文件**。
- 按**顺序**展示（会话顺序 / 消息顺序）。
- **标记每个会话/消息的时间戳**。
- 约束（用户明确要求）：**所有内容必须从页面元素提取**，不允许反推内部 API 偷懒。

## 2. 用户指令原文（按时间）

1. 「帮我把 kimi.com 上面的所有历史回话全部导出出来……每一个对话保存成一个 JSON 文件，按照顺序展示 —— 同时注意标记每个会话/消息的时间戳。」
2. 「你不要尝试偷懒，所有的内容要根据页面上的元素来。」
3. 「记录一个当前任务的日志（比如 docs/kimi-export-journal.md）……记录我的需求、指令、你尝试的方案、遇到的问题、每一步的步骤以及改进方案。」

## 3. 环境

- `plt status` → `extension: connected ✅`，sessions 2 个。
- 起点页面：`https://www.kimi.com/`（navId=3，tab=1854131902，viewport 1512x857）。
- `eval` 状态：`plt eval "return 1"` → `[EVAL_DISABLED] command 'eval' is disabled`（server 未开启）。

## 4. 尝试方案与步骤（时间顺序）

### 4.1 枚举会话列表

- `plt links --limit 60`：可见链接 60/265；确认会话 URL 形如
  `https://www.kimi.com/chat/<id>?chat_enter_method=history`，另有约 13 个导航链接。
- `plt links --all --limit 400 --json > /tmp/kimi_links.json`：拿到全部 265 条，其中
  **252 条为 `/chat/` 会话**（与用户所说 252 吻合）。会话按侧栏顺序（新→旧）。

### 4.2 会话页消息结构探索

逐层用 `plt extract --mode structured --selector ... --depth N` 下钻，得到结构：

```
.chat-detail-content
└─ .chat-detail-main
   └─ .chat-content-container
      └─ .chat-content-list
         ├─ .chat-content-item.chat-content-item-user
         │   └─ .segment.segment-user
         │      └─ .segment-container > .segment-content
         │         └─ [.segment-content-box / .okc-cards-container / .segment-user-action-row]
         └─ .chat-content-item.chat-content-item-assistant
             └─ .segment.segment-assistant
                └─ .segment-container > .segment-content
                   └─ .segment-content-box > .toolcall-rollup > .toolcall-rollup__part
                      └─ .markdown / .user-content / .toolcall-flow ...
```

- 每个 `.chat-content-item` 带 `data-archer-id` 与 `data-conversation-turn-id`（会话内消息定位）。
- 助手内容主要落在 `.markdown`（还有 `.markdown-container`、`.toolcall-content-text` 等）。
- 用户内容落在 `.user-content` / `.segment-user`。
- UI 噪声：`.segment-429-tip`（限流提示）、`.segment-user-action-row`（编辑/复制/分享）、
  `.segment-assistant-actions`（操作按钮）、`.toolcall-rollup`（思考/工具调用）。

### 4.3 时间戳探索

- 会话页内：`time`、`[class*=time]`、`[class*=date]`、`[title]` 均无匹配 → **会话内没有可见的时间元素**。
- 侧栏 `.next-sidebar-history-item__main` 只有 `__title`，**无时间**。
- **历史页 `/chat/history` 有时间**：文本出现分组「本周 / 昨天 / 今年」与条目日期
  （如 `2026年8月11日`）及预览摘要。
- 结论（暂定）：会话级时间戳需从 `/chat/history` 列表取；**消息级时间戳在当前 UI 不可见**，
  需要进一步确认（悬停？更多菜单？）。

### 4.4 被否决的路径（记录教训）

- 尝试 `plt fetch` 抓会话页 HTML → 只是 SPA 外壳（15.7KB，无消息、无 `__NEXT_DATA__`）。
- 尝试 `curl` SPA bundle grep API 路径 → 用户明确指出「不要偷懒，内容要基于页面元素」，**已停止**。

## 5. 遇到的问题 / 工具缺陷

1. **`eval` 默认禁用**：无法用页面上下文 JS 快速探查 DOM/状态；只能靠 `extract` 逐层下钻，效率低。
2. **structured 提取的文本截断**：每个节点 text 截断到 500 字符（`MAX_NODE_TEXT`），且总节点预算 500（BFS），
   深 DOM / 长消息会被截断，不适合直接拿正文。
3. **structured 输出不纯**：stdout 含 `📍 ...` 上下文头和末尾 `[showing X of N]`，不能直接 `JSON.parse`，
   需手动剥离（脚本里用 `indexOf('[')`/`lastIndexOf(']')` 处理）。
4. **`--json` 形状**：`plt <cmd> --json` 输出的是 `result` 对象（`{tabId,context,data}`），
   不是 `{id,result}` 信封（与文档直觉不同）。
5. **虚拟列表 / 动态渲染**：`.message-list`、`.chat-detail-content` 的浅层 children 为空，
   必须自己按 class 下钻才能找到真实节点；对不熟悉站点结构的 Agent 不友好。
6. **消息正文无原生 Markdown**：页面是渲染后的 HTML（`.markdown`），要拿到 Markdown 需要
   按 `.markdown` 元素的 DOM 结构重建（`<pre><code>`→代码围栏、`<ul>/<li>`→列表、`<strong>`→`**` 等）。
7. **时间戳缺失**：会话内无时间元素；历史页有会话级日期，**消息级时间戳未知**（待验证）。
8. **大量命令开销**：252 个会话 × 逐会话导航+多次提取，命令次数极大；无批量/脚本化能力（每命令一个进程）。
9. **无网络拦截 / 无剪贴板读取**：不能直接拿页面 XHR 响应或「复制」按钮写入的 Markdown。

## 6. 改进方案（给 ParkingLot）

- **DOM 精确取文**：`extract` 增加「按 selector 取节点的完整文本、不截断、直接输出纯 JSON 到文件」的模式（如 `--raw --out file.json`），去掉上下文头/分页尾巴。
- **Markdown 重建**：新增 `extract --selector X --to markdown`（或 `html-to-md`），把选中节点的 HTML 转成 Markdown（代码块/列表/表格/链接）。
- **轻量页面查询**：开放受控的 `eval`（或新增只读 `dom query/count/text` 命令），用于探测结构，避免逐层 `--depth` 下钻。
- **hover / tooltip 支持**：增加 `plt hover` 后读取 tooltip 的能力，用于取时间戳等悬浮信息。
- **批量执行**：`plt` 支持一次传入多条命令（脚本/管道），减少进程与 WS 往返开销；或提供 Node SDK。
- **结构化输出一致性**：`--json` 统一为信封；或明确文档化当前行为。
- **文本截断可配置**：`MAX_NODE_TEXT` / `MAX_STRUCTURED_NODES` 暴露为参数，或提供「按 selector 取完整子树」。
- **可读性/观测**：`extract` 支持排除指定 selector（如操作按钮、限流提示）。

## 7. 待办与下一步

- [ ] 确认消息级时间戳是否存在（悬停「更多」/消息操作区、或历史页条目详情）。
- [ ] 从 `/chat/history` 采集 252 个会话的「标题 + URL + 日期 + 分组」，建立有序清单。
- [ ] 逐会话提取用户/助手消息正文（Markdown 重建），落盘为 `<序号>-<标题>.json`。
- [ ] 汇总 `manifest.json`（顺序、标题、URL、时间戳）。
- [ ] 记录每次批量执行的成功/失败与耗时，形成更完整的工具评估。

## 8. 变更记录

- 2026-09-15：创建日志，记录至「探索消息结构 + 时间戳定位 + 已知缺陷/改进方案」。

## 9. 追加记录（2026-09-15 下午）

### 9.1 历史列表分页（inner scroll 限制）

- 历史页 `/chat/history` 左侧/中部列表**懒加载**，初始仅 15 条；`plt scroll bottom` 无效（`scrollY` 恒为 0，列表在内部滚动容器里）。
- **绕法**：对加载触发器元素做 `scrollIntoView` —— `plt scroll down --selector ".next-sidebar-history-list__load-more"`，每轮 +50：15 → 65 → 115 → 165 → 215 → **252**。
- 教训：`plt scroll` 目前无法滚动**内部 overflow 容器**（`--selector` 只做 `scrollIntoView`，不是 `scrollBy`）。这是明确改进项。

### 9.2 会话列表提取（252 条 + 日期）

- 结构：`.group-list-container` > `.group-name`（本周/今年） + `.group-list` > `.history-item-container` > `a.history-link[href]` + `.history-chat` > `.header`（`.title` / `.history-chat-meta > .date`） + `.content`（预览）。
- 用 structured + `offset`/`limit` 分 7 页（每页 40）取 `.history-chat`（标题/日期）与 `.history-link`（href），按序 zip → `/tmp/kimi_history.json`（252 条，全部有 href + 日期）。
- 日期归一化：`昨天/前天/今天/N天前/YYYY年M月D日/M月D日`（无年份时按基准日 2026-09-15 判断年份）。

### 9.3 消息内容：thinking / content 混淆（关键问题）

- 会话页结构：`.chat-content-list` > `.chat-content-item-user` / `.chat-content-item-assistant` > `.segment` > `.segment-container` > `.segment-content` > `.segment-content-box`。
- `.segment-content-box` 的 `innerText` 把 **thinking（.toolcall-content-text / .toolcall-flow）与 content（.markdown）混在一起**，且渲染后 Markdown 标记丢失（`**`/`##` 被渲染掉）。
- 单独用 `.markdown` 会碎成很多块（某会话一条助手消息 31 个 `.markdown`），且含“表格/复制”等 UI 文本。
- 历史页 `.content` 预览倒是**原始 Markdown**，但被截断（仅预览）。

### 9.4 500 字符截断的来源

- `packages/extension/src/dom/snapshot.ts:35` `MAX_NODE_TEXT = 500`，由 commit **`407d0f8`（v2 增量，2026-09-14 12:59）随 `extract --mode structured`** 引入；`directText()`（只取直系文本子节点）超 500 截断并加 `…`。
- 另有 `MAX_STRUCTURED_NODES = 500` 的节点预算（BFS 截断）。

### 9.5 工具改进：新增 `extract --mode html` + 去掉文本截断（已实现）

- 新增 `extract --mode html`：按 selector 返回每个匹配元素的 **`outerHTML`**（第一层列表 = 匹配元素本身；无文本截断），结果 `{ mode:'html', items:string[], total, offset?, limit? }`。
- 移除 structured 的 500 字符截断（`MAX_NODE_TEXT` 删除；节点预算 500 保留）。
- 改动文件：`protocol/src/methods.ts`、`protocol/src/schemas.ts`、`extension/src/dom/snapshot.ts`、`server/src/cli.ts`、`protocol/schemas.test.ts`、`extension/dom/snapshot.test.ts`、`skills/parkinglot/references/protocol.md`。
- 验证：`pnpm typecheck && pnpm test`（protocol 37 / server 52 / extension 80）`&& pnpm lint && pnpm build` 全绿；扩展已重建，**需在 chrome://extensions 重载 unpacked 扩展**后生效。
- 用途：`plt extract --mode html --selector ".segment-content-box"` 拿到完整 HTML，再按 class 区分 thinking（`.toolcall-content-text`/`.toolcall-flow`）与 content（`.markdown`）。

### 9.6 导出管线现状

- 驱动脚本 `/tmp/export_kimi.js`：`goto` → structured 取角色 → text 取 `.segment-content-box` → 写 `exports/kimi/NNN-<title>.json` + `manifest.json`。
- 已生成 **134/252**（被暂停）；内容为渲染文本（thinking/content 混合），待 `--mode html` 重做。
- 输出目录：仓库内 `exports/kimi`（已在 `.gitignore` 忽略 `exports/`）。
- 会话/消息时间戳：会话级有（历史页日期）；**消息级 DOM 无时间元素**，仅在部分 thinking 文本里出现 `当前会话时间 YYYY-MM-DD HH:mm +08:00`（已用正则捕获）。

### 9.7 改进项更新（给 ParkingLot）

- [ ] `scroll` 支持滚动内部容器（`--selector` + `scrollBy`/`scrollTop`），或新增 `scroll-to <selector>` 明确语义。
- [x] `extract --mode html`（outerHTML、无截断）。
- [x] 去掉 structured 文本 500 字符截断。
- [ ] `extract --to markdown`（HTML→Markdown），便于直接产出可读正文。
- [ ] `extract` 支持排除 selector（去掉操作按钮/限流提示等噪声）。
- [ ] 结构化结果按 selector 取**完整子树全文**（当前 structured 的 text 仅直系文本）。
- [ ] 批量/脚本化执行（减少每命令一个进程的开销）。
- [ ] 消息级时间戳若页面确实不提供，文档应明确“不可得”，避免 Agent 反复试探。

## 10. 追加记录（2026-09-15 傍晚）—— raw HTML 导出 v2

### 10.1 用户反馈与方案调整

- 用户反馈：`.segment-content-box` 的文本把 **thinking 与 content 混在一起**，要求**直接导出 assistant 的 raw HTML**，以便按结构区分。
- 已实现并启用 `extract --mode html`（见 9.5）；扩展重载 + server 重启后生效（自检：`plt extract --mode html --selector "h1" --json` 返回 `"mode":"html"`）。

### 10.2 v2 导出实现

- 驱动 `/tmp/export_kimi_html.js`：每个会话 `goto` → `plt extract --mode html --selector ".chat-content-item"`（**1 次提取**拿到全部 turn 的 outerHTML）→ 按 class 判 role → 写 JSON。
- 输出：`exports/kimi-html/NNN-<title>.json`（含 `order/title/url/date/messages[{index,role,html}]`）+ `manifest.json`。
- 特点：assistant 项内同时含 thinking（`.toolcall-content-text` / `.toolcall-flow`）与 content（`.markdown`），**可按 class 在下游区分**；无文本截断。
- 相比 v1（每会话 2 次提取 + 混合文本），v2 更快且无损。

### 10.3 本次新发现的问题

- **session 泄漏（待查）**：反复 `plt goto` 后 `plt status` 显示 **158 个 session**（与导出会话数相当），说明每次 `goto` 都新建了 session，而不是复用默认 session。需要检查默认 session 的解析/持久化逻辑（`session.ts` resolve + state file），这会让长时间批量操作产生大量无用 session。
- inner-scroll 限制（见 9.1）再次确认：`plt scroll` 无法滚动内部容器，只能靠 `scrollIntoView` 触发器元素绕过。

### 10.4 结果（完成）

- 输出：`exports/kimi-html/`，**252 个会话 JSON + manifest.json**；总消息 **1260**（628 user + 628 assistant 中 628 助手含 `.markdown`，423 条含 thinking 块）；总体积 **16.2 MB**；0 unknown role。
- 空会话 1 个：`224-未命名会话`（页面实测无消息，属正常）。
- 数据 schema：`{ order, title, url, date, dateRaw, messageCount, source, extractedAt, messages:[{index, role, html}] }`；`html` 为 `.chat-content-item` 的 outerHTML（thinking/content 可按 class 区分）。

### 10.5 本次新发现的问题

- **0 消息误判（时序）**：首次导出对 `040-涨价去库存现象解析` 存了 0 条，重试得到 4 条 —— 原因是 `goto` 后固定 `sleep 1.5s` 太短，页面尚未渲染消息。教训：应等待 `.chat-content-item` 出现或轮询，而不是固定 sleep；这也是 `wait --selector` 的用武之地（但当时会话容器选择器需先探索）。
- **session 泄漏（待查）**：反复 `plt goto` 后 `plt status` 显示 **100+ session**（与导出会话数量级相当），说明每次 `goto` 都新建 session 而非复用默认 session。需检查 `session.ts` 的默认 session 解析/持久化；长批量操作会累积大量无用 session。
- inner-scroll 限制（见 9.1）再次确认：`plt scroll` 无法滚动内部容器，只能靠 `scrollIntoView` 触发器元素绕过。

### 10.6 改进项更新

- [ ] **修复 session 复用**：批量 `goto` 应复用默认 session（或显式 `--session`）。
- [ ] **等待策略**：导出/批处理应支持“等待选择器出现”（`wait --selector` 已有，但需在固定 sleep 处改用）。
- [ ] `scroll` 支持内部容器滚动。
- [x] `extract --mode html`（v2 导出依赖）。
- [ ] `extract --to markdown`（HTML→Markdown）。
- [ ] 批量/脚本化执行（减少进程与 WS 开销）。

## 11. 综合 Review（2026-09-15）

对象：用 `plt`（server 0.3.0 + unpacked 扩展）批量导出 kimi.com 全部历史（252 会话 / 1260 消息 / 16.2 MB）。

### 11.1 工具能力是否足够 / 需要扩展

**结论：能完成，但靠大量绕行。核心缺 3 类能力。**

必须扩展：

1. **DOM 直接查询/检索**：没有“按 class/文本找元素”，只能 `--depth` 逐层盲试。需要 `dom query <css>`（匹配数 + tag/class/text/box）并暴露按可见文本定位（`findByText` 已实现）。
2. **批量/脚本执行**：每命令一个进程 + 一次 WS 往返。本次约 500+ 命令、~10 分钟；`plt` 应支持一次提交多条命令（脚本/文件/stdin）或 Node SDK。
3. **内部容器滚动**：`scroll --selector` 只做 `scrollIntoView`，无法滚动 overflow 容器；历史列表靠反复 `scrollIntoView(.next-sidebar-history-list__load-more)` 触发（15→…→252）。需要真正的 `scrollBy`/`scrollTop`。

建议扩展：`extract --to markdown`；`extract` 支持 exclude selector；批处理默认 `wait --selector`（本次 1 条会话因 `sleep 1.5s` 太短误存 0 条）；剪贴板读取；iframe/shadow DOM。

### 11.2 是否 intuitive / 支持自探索自动化

**结论：中等偏好；对“未见过的新站点”探索成本很高。**

- 好：命名直观、错误码清楚、`links`/`page-info`/context 快照有用、`extract structured` 可逐步逼近。
- 差：
  - **单 root 语义反直觉**：selector 只匹配 1 个元素时结构化返回其**子元素**（曾误判 `.message-list` 为空）。
  - **stdout 非纯数据**：`📍 ...` 头 + `[showing X of N]` 尾，`JSON.parse` 失败需手工剥离。
  - **`--json` 形状不一致**：输出 `result` 对象而非 `{id,result}` 信封。
  - **探测手段受限**：`eval` 默认禁用 → 无法用页面 JS 探查。
  - **动态/虚拟渲染**：`.main` 文本有内容但结构化浅层 children 为空，需反复试 selector。
  - **批量无指导**：无“导出全部”模式，Agent 需自拼 goto+extract 循环并处理时序。
- 判断：静态/规整页面够用；懒加载/虚拟列表/深嵌套站点自探索代价高。补齐 11.1 的 1/2/3 后可行。

### 11.3 安全问题 / 风险

- **敏感数据明文落地**：16.2 MB 私人对话（含 thinking）明文 JSON；无提示/加密/审批（已人工 `.gitignore exports/`）。
- **账本记录 URL**：`ledger.ts` 敏感键不含 `url`，`goto` 的会话 URL（含 chat id）与 `search` query 持久化到 `~/.parkinglot/ledger.jsonl`。
- **HTTP API 无鉴权/无 Origin 校验**：批量期间任意本机进程（或网站端 localhost CSRF）可驱动浏览器；配合 `<all_urls>` + 登录态影响面大。
- **单脚本可批量外泄全部历史**：无速率限制/二次确认/默认域白名单（`allowedHosts` 空=全放行）。
- 正面：`eval` 默认禁用、WS 需 token、server 仅回环。
- **状态文件无上限**：session 泄漏把 `sessions.json` 撑到 414 条。

### 11.4 多余 / 过度设计

- **`structured` 与 `html` 部分重叠**：`structured` 不适合取正文（直系文本 + 节点预算），`html` 更通用。
- **defuddle 全量打包**：`article` 让 `content.js` ≈760 KB，本次未用 → 低频功能高体积代价。
- **两套版本概念**（package version vs `PROTOCOL_VERSION`）对使用者偏重，且无运行时校验。
- **MAIN world 原型补丁**（keyCode）：已知反检测指纹 + 复杂度。
- **session/navId/context 模型偏重且脆弱**：见 11.5。
- 可选简化：`selection`/`forms` 本次未用（`links` 有用）。

### 11.5 session 泄漏根因（重要）

- 旧模型 `Session = { id, tabId?, createdAt, lastUsedAt, context? }`，**硬绑定 tabId**。
- `resolve()` 默认分支要求 `s.tabId !== undefined`（`session.ts:157-166`）；一旦默认 session 的 tabId 被清（`unbindTab`，如 tab 关闭/重启后失效），默认分支永不命中 → 每次 `goto` 落到 `latestTabId` 分支并 `create()` 新 session（`router.ts:244-249`）。
- `create()` 只在“无默认 session”时设默认，故默认 session 永远不恢复 → **每次 goto 泄漏一个 session**（本次 414 条；`pl-094a86e1` 无 tabId 即为卡死的默认 session）。
- 结论：**session 不应绑定 tabId**，需要重新设计（另议），并顺带支持多 Agent / 多浏览器与“后台自动化 tab 不打扰用户”。

## 12. Session 概念移除（2026-09-15 晚）

用户决定：**先不做 `docs/session-redesign.md` 的大改，直接移除 session 概念**，从根上消除泄漏；不考虑向后兼容。

### 12.1 新寻址模型

- 目标寻址：`params.tabId` / `--tab <id>`（显式，临时）> **server 当前 tab**（软指针，由最近成功命令设置）> **最近激活 tab**（`latestTabId`）。
- 无目标可用且命令需要目标 → `EXTENSION_NO_TAB`。
- 当前 tab 失效（`tab.removed` 事件或扩展报 `TAB_CLOSED`）→ 清除，下条命令回退。
- 不再持久化任何 session/tab 状态 → **无泄漏**。

### 12.2 移除/新增

- 删除：`packages/server/src/session.ts`（含 `SessionRegistry`）、`session.test.ts`、`~/.parkinglot/sessions.json` 的使用、`/api/session`、`get-status.sessions`、`SessionInfo`、信封 `sessionId`、`SESSION_NOT_FOUND`/`SESSION_TAB_CLOSED`、`--session`、`plt session`。
- 新增：`packages/server/src/target.ts`（`TargetState`，内存软指针）、错误码 `TAB_CLOSED`、CLI 全局 `--tab <id>`、`get-status.currentTabId`。
- 扩展：去掉 `sessionId` 透传；tab 失效映射由 `SESSION_TAB_CLOSED` → `TAB_CLOSED`。

### 12.3 验证

- `pnpm typecheck && pnpm test`（protocol 37 / server 37 / extension 80）`&& pnpm lint && pnpm build` 全绿；E2E 待跑。
- 文档：protocol.md / SKILL.md / example.md / README / AGENTS / TODO 去 session；`docs/session-redesign.md` 标记 DEFERRED。

### 12.4 行为变化

- 所有命令共享一个“当前 tab”；需要并行/多目标时用 `--tab`。
- 破坏性变更（`--session`/`plt session`/`sessionId` 移除）——按用户要求不标兼容、不保留旧接口。

## 13. Chromium issue 383343320 评估（MV3 popup 慢 / SW 被降权）

- 页面：`https://issues.chromium.org/issues/383343320`（“Popups of MV3 extensions take too long to open”）。
- **comment #19** 给出根因（macOS，实测）：Chrome 的 `PMProcessPriorityPolicy` 把所有扩展进程（`--extension-process`）置为 `PRIO_DARWIN_BG`（`ps -o pri`=4）→ 只能跑能效核，重负载下被饿死；SW 对平凡请求可 3–43s 无响应 → popup 渲染延迟 500ms–数分钟。加 `--disable-features=PMProcessPriorityPolicy` 恢复 PRI 47、0 卡顿（`--disable-renderer-backgrounding` 单独无效）。#9 也观察到“有可见扩展页面时 bug 消失”。
- **我们的代码无法避免**：这是 Chrome 在 OS 进程调度层对扩展进程降权，扩展 JS（SW/popup/content script）不能改变自身进程优先级；所有 MV3 扩展同等受影响。
- 影响：SW 持 WS + 处理命令，被降权时命令延迟/超时、保活心跳拖延——**环境问题，非本工具缺陷**。
- 可缓解（非我们层面）：以 `--disable-features=PMProcessPriorityPolicy` 启动 Chrome；避开重负载；保持扩展页面常驻（抬优先级，但 offscreen 是否有效未验证，不依赖）。
- 结论：Chrome 的锅，不追。
