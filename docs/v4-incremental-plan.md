# v4 Incremental Plan — 工具可用性 / 探索能力 / 批量执行

批准日期：待定
状态：**草案 v0.2（challenge 后修订；源自 `docs/kimi-export-journal.md`；不含已解决的 session 项与安全专项）**
关联：`docs/kimi-export-journal.md`（第 9/10/11 节）、`docs/v3-incremental-plan.md`

## 背景

Kimi 全量导出实战暴露的工具缺口（journal 第 9–11 节）。本计划只把它们排成可执行增量，**不引入新需求**。

## Challenge 修订（2026-09-15）

- **去掉 `extract --to markdown`**：实测 `plt extract --article --selector ".markdown"` 已返回 Markdown（defuddle `markdown:true`）。`--article` 即 Markdown 提取路径，无需新命令；文档写明其“主内容 + frontmatter”语义即可。
- **iframe/shadow 拆出延后**：开启 `all_frames` 会让 `chrome.tabs.sendMessage` 命中所有子 frame（`content.ts` 多监听器竞争响应），需要 frameId 路由，属独立计划（与 `docs/session-redesign.md` 有重叠）。
- **等待并入批量**：`wait` 已存在，作为独立增量价值低，并入批量增量。
- **scroll 采用“直接改语义”**（用户决定），但要显式文档化行为变化。
- 补 **v3 式协议集成清单**（新命令易漏改）。
- 下调批量收益预期：`plt run` 省的是进程/连接开销，**不减少每命令的 WS 往返与导航等待**。

## 范围（全部来自 journal）

| #   | 能力                                                                                                                 | 来源        |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| A   | **探索命令** `dom-query`：按 CSS/文本查询元素（匹配数 + tag/class/text/box）                                         | 11.1 / 11.2 |
| B   | **提取增强**：`extract --exclude <css>` 去噪；structured 取完整子树全文；文档写明 `--article --selector` 即 Markdown | 9.7 / 11.1  |
| C   | **滚动内部容器**：`scroll --selector` 改为真正滚动 overflow 元素                                                     | 9.1 / 11.1  |
| D   | **输出可编程**：`--json` 纯净、形状一致                                                                              | 11.2        |
| E   | **批量/脚本执行**（含等待策略）                                                                                      | 10.5 / 11.1 |

**排除/延后**：session（已移除）、安全专项（`docs/TODO.md` Future plan）、反侦测指纹（`docs/TODO.md` Risks）、iframe/shadow（独立计划）、剪贴板读取（可选）。

## 增量顺序

```
1 (D 输出可编程) → 2 (C 内部滚动) → 3 (B 提取增强) → 4 (A dom-query) → 5 (E 批量+等待)
```

- 1 是基础（脚本/批处理依赖可解析输出）。
- 2/3/4 相互独立，可与 5 并行。
- 5 依赖 1。

### Increment 1 — 输出可编程（D）

**结果**：`plt <cmd> --json` 输出可直接 `JSON.parse`（无 `📍` 头、无 `[showing …]` 尾），形状统一。

**变更**

- `packages/server/src/cli.ts`：`--json` 下所有 `extract` 分支只打印一次结构化 JSON（含 `mode/total/offset/limit/truncated` 等元信息）；去掉 `formatContext` 头与 `paginationLine` 尾；不再附加 `🔔 … events` 文本。
- 统一 `--json` 形状为 `result` 结构 `{ tabId, context, data }`（**不带 `id`**，避免为传递 envelope id 增加改动面）。
- 人读输出保持现状。

**验证**：`plt extract --selector x --json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"` 成功；CLI 层纯函数单测。

### Increment 2 — 内部容器滚动（C）

**结果**：`scroll --selector` 真正滚动 `overflow` 容器（如懒加载列表），可反复触发加载。

**变更**

- `packages/extension/src/dom/actions.ts`：`scroll` 带 `selector` 时改为操作该元素滚动（`scrollTop`/`scrollBy`，支持 `direction`/`amount`），**不再** `scrollIntoView`。
- 保留无 selector 的整页滚动行为。
- **行为变化**：需在 protocol.md/SKILL 明确“`scroll --selector` 现在滚元素内部；要滚到元素请用 `scroll-to <selector>`”。新增 `scroll-to <selector>`（= `scrollIntoView`）以保留旧能力。

**验证**：`actions.test.ts`（元素 `scrollTop` 变化）；E2E：mock 懒加载列表，滚动后计数增加。

### Increment 3 — 提取增强（B）

**结果**：可从提取结果中剔除噪声元素；structured 可拿到完整子树文本。

**变更**

- `extract --exclude <css>`：在 text/html/structured 取结果前移除匹配元素（如操作按钮、限流提示）。
- structured：新增“取完整子树全文”选项（当前 `directText` 仅直系文本）；若判定由 `html` 模式取代，则文档明确并关闭该选项（实施时定）。
- 文档：写明 `extract --article [--selector]` 即 Markdown 提取路径及其“主内容 + frontmatter”语义。

**验证**：`snapshot.test.ts`/`collect.test.ts`（exclude 过滤、子树全文）；protocol schema；E2E 各 1 条。

### Increment 4 — 探索命令 `dom-query`（A）

**结果**：一条命令了解某 selector/文本的匹配情况，无需逐层 `--depth` 下钻。

**变更**

- protocol：新增只读命令 `dom-query`（`{ selector?, text?, limit? }`）→ `{ matches: [{ tag, class, id?, text?, box? }], total }`；`text` 走 `locator.findByText`。
- extension：DOM 命令实现（复用 `findByCss`/`findByText`/`toElementInfo`）。
- CLI：`plt dom-query <css>` / `--text <s>`。

**协议集成清单（易漏，需逐项核对）**
`METHODS`、`paramsSchemas`、`MethodMeta/METHOD_META`、`ResultMap`、`runtime.ts` 导出、`router.NEEDS_TARGET`、`router` 的 `EXTENSION_FREE`/寻址、`cli.GROUPS`、`cli.printResult`、`exitCodeFor`、`ledger.redactParams`（如涉及）、protocol.md/SKILL、单测/E2E。

**验证**：`locator`/新 DOM 单测（匹配/文本/歧义）；protocol schema 测试；E2E 1 条。

### Increment 5 — 批量/脚本执行 + 等待（E）

**结果**：一次进程执行多条命令，并用 `wait` 替代固定 sleep。

**变更**

- CLI：`plt run <file|->`（JSON lines：`{ method, params, tabId? }`），顺序执行、逐条输出（`--json` 时为 JSON lines）；`--fail-fast` 可选，默认遇错继续并汇总。
- 文档：批处理中用 `wait --selector`/`wait --condition` 等待，不写死 sleep。
- 作用域：仅 CLI 编排，不改协议（每条仍是现有命令）。
- 期望：省进程/连接开销；**不减少**每命令 WS 往返与导航等待。

**验证**：单测（解析/顺序/失败策略）；E2E：一次 `plt run` 执行 goto+wait+extract 序列。

## 每增量完成后检查

```
pnpm typecheck && pnpm test && pnpm lint && pnpm format
```

## 最终验证

- 全量：`pnpm typecheck && pnpm test && pnpm build && pnpm lint`
- E2E：`pnpm test:e2e`
- 手动：`plt --help`；`plt extract … --json` 可 `JSON.parse`；`plt run` 批量脚本跑通；`plt dom-query` 可用。

## 未决事项

- Increment 1：`--json` 是否接受不含 `id`（当前决定：不含）。
- Increment 3：`structured` 是否保留完整子树全文选项，或由 `html` 模式取代。
- Increment 5：脚本格式（JSON lines）与失败策略默认值。
- 后续独立计划：iframe / shadow DOM（frameId 路由）、剪贴板读取。

## 执行记录与偏差（2026-09-16）

Increment 1–5 完成。验证：`pnpm typecheck` / `pnpm test`（protocol 39 / server 37 / extension 85）/ `pnpm build` / `pnpm lint` 全绿；`pnpm test:e2e` **32 passed**。

| #   | 增量       | 结果                                                                                                                                                                         |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 输出可编程 | 核对现状：`--json` 已是单行可解析的 `{tabId,context,data}`，无需改动（验证即完成）                                                                                           |
| 2   | 内部滚动   | `scroll --selector` 改为滚动元素自身（`scrollBy`）；新增 `scroll-to <selector>`（保留 `scrollIntoView`）；文档更新                                                           |
| 3   | 提取增强   | 新增 `extract --exclude <css>`（text/structured/html 生效，克隆剔除不改页面）；structured 全文改为文档说明（`html` 模式覆盖）；文档写明 `--article [--selector]` 即 Markdown |
| 4   | dom-query  | 新命令 `dom-query`（selector 或可见文本 → `{matches,total}`）；协议集成清单逐项落地                                                                                          |
| 5   | 批量+等待  | 新增 `plt run <file.jsonl\|->`（`--json` 逐行、`--fail-fast`）；文档给出用 `wait` 替代 sleep 的写法                                                                          |

偏差/补充：

1. **Increment 1 无需代码**：实测 `--json` 已满足“单行可解析 + 形状为 `{tabId,context,data}`”。
2. **structured 全文**：因 `extract --mode html` 已提供完整子树内容，未新增 structured 选项，改为文档说明（避免命令面膨胀）。
3. **`--to markdown` 删除**：实测 `extract --article --selector` 已返回 Markdown（challenge 修订）。
4. E2E 新增 7 条（scroll 内部容器 / dom-query / exclude / plt run / extract --mode html / scroll-to / --json 严格解析）；scroll 的 mock 初版行高不足导致无可滚动区域，已修正。
