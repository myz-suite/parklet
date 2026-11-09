# v5 Incremental Plan — 时间线抓取可靠性优先（P0 / P1 / P2）

批准日期：待定
状态：**约定范围已完成（v1.0，2026-11-03；Increment 12 跳项/空窗强 gap 断言暂未覆盖）**
关联：`docs/TODO.md`、`docs/v4-incremental-plan.md`、`docs/protocol.md`
说明：原 v5 草案的 Shadow DOM / iframe / 上传 / 下载 / 网络观测等能力移到 **附录 B**，不作为当前优先级。

## 0. Increment 0 已完成（测试基线）

**结果**：E2E 不再依赖外部站点；后续增量的本地夹具已就绪。

已验证：

- `pnpm test:e2e`：**32 passed**（原 example.com 失效用例已改为本地页面）。
- `pnpm typecheck` / `pnpm test`（161）/ `pnpm lint` / `pnpm format:check` 全绿。
- fixture 首页改为本地站点；`Session` 增加 `web` 夹具 origin。
- 新增夹具路由：`/shadow`、`/frame-host`、`/frame-child`、`/dialogs`、`/upload`、`/download`、`/network`、`/api/slow`。
- 变更文件：`tests/e2e/support.ts`、`tests/e2e/parklet.e2e.spec.ts`。

**遗留**：Increment 12 的跳项/空窗强 gap 断言未覆盖（已记录在执行记录中）。

## 1. 背景与目标

X/Twitter 时间线抓取暴露的核心问题是**副作用不可验证**：

- `scroll` 发出即返回（smooth），`scrollY` 没动也报成功；后台标签页会被 Chrome 节流。
- 没有结构化字段抽取，精确时间只能靠 `eval`（默认禁用且有 CSP/安全争议）。
- 虚拟列表需要“滚动 → 抽取 → 去重 → 停止”的循环，靠人工 75 次滚动不可复现。
- stdout 混入事件通知，机器解析被迫加 `2>/dev/null`。
- tab/`--tab` 语义不统一，容易“看着切了、实际没切”。

**目标**：用一条可验证的命令，按固定轮次稳定采集虚拟列表，并输出采集过程、去重结果与停止原因；不承诺“覆盖多少小时”这种无法证明的结论。

**成功标准**：

- `plt scroll` 返回真实 `before/after/delta`；`delta === 0` 不再静默成功。
- `plt extract --fields` 不依赖 `eval` 拿到作者、`<time datetime>`、正文等字段；缺失字段为 `null`。
- `plt collect --repeat N` 完成“抽取 → 小步滚动 → 等待 → 去重 → 固定轮次停止”，输出 `items / scrolls / duplicates / stoppedReason / steps / observed`。
- stdout 只有数据；日志、事件、通知全部走 stderr。
- 采集结果可复现：固定 `--repeat`、固定滚动步长，输出每轮新增数与滚动增量。

**非目标（本阶段）**：

- **不做“覆盖 3 小时”的承诺**：虚拟列表与相对时间无法保证完整覆盖；`until-older-than` 不作为 v5 的停止条件。
- **不做只读模式**（`--read-only` / `PARKLET_READONLY`）：不纳入产品范围。
- **不做限速/限流识别**：不作为 v5 的通用能力；采集轮次由 `--repeat` 控制。
- **不移除 `search`**：Google/DDG 搜索保留；上一轮是使用方式问题，不是功能问题。
- 不新增点赞/关注/转发/发帖等写操作。
- 不做反侦测/指纹绕过；不承诺 `isTrusted=true`。
- 不引入 `chrome.debugger`（CDP）。
- 不继续扩展 Shadow DOM / iframe / 上传 / 下载 / 网络拦截（见附录 B）。

## 2. 设计原则

1. **副作用必须可验证**：动作返回前后状态；不可验证就报错，不静默成功。
2. **固定轮次、可复现**：`collect` 用 `--repeat N`，而不是依赖时间窗口或页面文案。
3. **小步、去重、可停止**：虚拟列表每次滚动不超过视口高度；每轮抽取并去重。
4. **stdout = 数据，stderr = 诊断**：事件、进度、上下文头、警告一律 stderr；`--quiet` 可静默。
5. **单一 current target**：server 维护一个 current target；`plt tab`/`tab-new` 激活并写回，普通命令的 `--tab` 也写回 current 但不会自动激活浏览器 tab；`plt tabs` 分别标记 `*` active 与 `>` current。
6. **不依赖 eval**：结构化字段抽取走协议内建能力。
7. **不制造虚假完整性**：只报告观察到的数据与轮次，不宣称覆盖时间窗口。

## 3. 优先级总表

| 阶段 | #   | 增量                      | 依赖    | 结果                                                                 |
| ---- | --- | ------------------------- | ------- | -------------------------------------------------------------------- |
| P0   | 1   | scroll 契约重做           | —       | 同步、可验证、后台标签页不再静默失败                                 |
| P0   | 2   | `extract --fields`        | —       | 结构化记录数组，支持 `@attr` 与精确时间                              |
| P0   | 3   | `collect --repeat`        | 1, 2    | 固定轮次采集；输出步骤、去重、停止原因、观察范围                     |
| P0   | 4   | stdout/stderr 分离        | —       | 数据纯 stdout；事件/日志 stderr；`--quiet`                           |
| P1   | 5   | tab 语义统一              | —       | current target；`tab` / `tab-new` / `tab-close`；active/current 分列 |
| P1   | 6   | `click-text` 可点击性判定 | —       | 纯文本不参与歧义；多个可点击才报错                                   |
| P1   | 7   | `wait` 增强               | —       | 数量稳定、计数、SPA 内容就绪                                         |
| P1   | 8   | links/forms 并入 extract  | —       | 删除顶层命令；`extract --mode links\|forms`；修作用域                |
| P2   | 9   | `page-info` 增强          | —       | activeElement/selection/readyState/scroll 快照                       |
| P2   | 10  | `run` 变量与输出传递      | 4       | 变量替换、`as` 捕获；循环另行评估                                    |
| P2   | 11  | `screenshot` 自动聚焦     | 5       | 元素截图不再要求用户先手动切 tab                                     |
| P2   | 12  | 虚拟列表对抗性 E2E        | 1, 2, 3 | 重复渲染/跳项/空窗/后台 tab 回归                                     |

## 4. P0 增量

### Increment 1 — scroll 契约重做

**结果**：`plt scroll` 是同步、可验证的；后台标签页不再出现“命令成功但页面没动”。

**CLI 契约（破坏性变更）**

| 旧用法                    | 新用法                             | 说明               |
| ------------------------- | ---------------------------------- | ------------------ |
| `plt scroll down`         | `plt scroll --by 850`              | 正数向下，负数向上 |
| `plt scroll 850`          | `plt scroll --by 850`              | 位置参数删除       |
| `plt scroll up`           | `plt scroll --by -850`             | 不再用方向词       |
| `plt scroll top`          | `plt scroll --to top`              |                    |
| `plt scroll bottom`       | `plt scroll --to bottom`           |                    |
| `plt scroll --selector x` | `plt scroll --selector x --by 400` | 滚动元素内部       |

参数：

- `--by <px>`：滚动像素；与 `--to` 互斥。
- `--to <top|bottom>`：跳到边界；与 `--by` 互斥。
- `--selector <css>`：滚动元素内部（保留现有语义）。
- `--smooth`：平滑滚动（默认 `auto`）；仍等待稳定。
- settle 默认开启；`--no-settle` 关闭（最多等待 1s）。
- `--focus`：滚动前由 background 激活目标 tab；激活失败则命令报错。`BACKGROUND_TAB` 只在滚动成功但文档仍隐藏时作为警告返回。
- `--allow-noop`：允许 `delta === 0`；默认报 `NO_EFFECT`。

**返回形状**

```ts
interface ScrollResult {
  target: 'page' | { selector: string };
  before: { x: number; y: number };
  after: { x: number; y: number };
  delta: { x: number; y: number };
  atTop: boolean;
  atBottom: boolean;
  settled: boolean;
  visibilityState: 'visible' | 'hidden';
  viewport: { width: number; height: number };
  warning?: 'BACKGROUND_TAB';
}
```

元素内部滚动时取 `scrollTop/scrollLeft`；可选择附带 `scrollHeight/clientHeight`。

**行为**

- 默认 `behavior: 'auto'`；`--smooth` 才平滑，但仍等稳定。
- `delta === 0` → `NO_EFFECT`，`error.data` 带 `before/after/atTop/atBottom`；`--allow-noop` 放行。
- `document.visibilityState === 'hidden'` → `warning: 'BACKGROUND_TAB'`；CLI stderr 提示建议 `--focus`。
- `--focus` 由 background 在转发前激活目标 tab；由于 **激活即 current**，这会同时切换默认目标。
- `scroll-to` 同步改为 `behavior:auto` + settle，并返回 `before/after/delta`。

**验证**

- 单测：`--by`/`--to` 解析、互斥校验、返回形状、`NO_EFFECT`、settle 轮询。
- E2E（`/tall`）：`--by 850` 后 `scrollY` 增量精确为 850（±1）；`--to bottom` 后 `atBottom`；再滚一次 `NO_EFFECT`。
- E2E（`--focus`）：非 active tab 执行 scroll 后目标 tab 变为 active，且 `delta > 0`。
- 后台隐藏 tab 的 `BACKGROUND_TAB` 警告由单元测试覆盖（headless Chromium 不保证隐藏 tab 的 `visibilityState`）。
- 手动：连续 3 次 `--by 850`，`page-info.scrollY` 每次按 850 递增。

**完成标准**：滚动不再“发出即成功”；后台标签页行为可见。

### Increment 2 — `extract --fields` 结构化字段抽取

**结果**：无需 `eval`，直接按行输出结构化记录；精确时间从 `<time datetime>` 读取。

**CLI 契约**

```bash
plt extract --selector "article[data-testid='tweet']" \
  --fields "author=[data-testid='User-Name'] span,handle=[data-testid='User-Name'] a,datetime=time@datetime,text=[data-testid='tweetText']" \
  --json
```

字段语法：

- `name=selector`：取可见文本（`innerText`，空白归一化）。
- `name=selector@attr`：取属性；`@text` 显式取文本。
- `name=selector1|selector2`：按顺序取第一个命中。
- `\,` 转义逗号，`\|` 转义竖线；复杂选择器用 `--fields-file <path>`（文件内含 JSON 数组）。
- `--fields-file`：`[{ "name": "author", "selector": "...", "attr": "datetime" }]`。
- 缺失字段固定输出 `null`（不提供 `--omit-null`，保持记录形状稳定）。
- `--visible-only`：按行过滤不可见元素。
- `--offset` / `--limit`：按行分页。
- `--exclude`：在行与字段提取前剔除匹配元素。

**wire 形状**

```ts
interface FieldSpec {
  name: string;
  selector: string;
  alternatives?: string[]; // selector 未命中时依次尝试
  attr?: string; // 缺省 = text
}

interface ExtractFieldsParams {
  selector: string; // 行选择器，必填
  fields: FieldSpec[];
  offset?: number;
  limit?: number;
  visibleOnly?: boolean;
  exclude?: string;
}
```

结果：

```json
{
  "mode": "fields",
  "items": [{ "author": "...", "handle": "...", "datetime": "2026-11-03T...", "text": "..." }],
  "total": 25,
  "offset": 0,
  "limit": 10
}
```

- `@href` / `@src` 解析为绝对 URL；`@datetime` 保留原始值。
- 多个字段元素命中时取第一个可见，否则取第一个。
- `fields` 与 `mode` / `article` 互斥；`selector` 必填。
- 行不套用 `firstLayerElements`。

**验证**

- 单测：字段语法解析（`@attr`、fallback、转义）、缺失字段 `null`、行分页、绝对 URL。
- E2E：`/feed` 或 `/list` 上 `--fields "id=a@href,text=..."`；断言 `items.length`、`datetime`、`text`。
- 手动：真实 X 时间线，`datetime` 来自 `<time datetime>`，不是相对时间。

**完成标准**：不开启 eval 也能拿到精确时间与正文；输出可直接 JSON 解析。

### Increment 3 — `plt collect --repeat` 固定轮次采集

**结果**：一条命令按固定轮次完成“抽取 → 小步滚动 → 等待 → 去重”，输出可复现的步骤报告；不声称覆盖时间窗口。

**CLI 示例**

```bash
plt collect "article[data-testid='tweet']" \
  --fields "author=[data-testid='User-Name'] span,datetime=time@datetime,text=[data-testid='tweetText']" \
  --repeat 10 \
  --scroll-by 800 \
  --dedupe-key author,text --dedupe-prefix 80 \
  --json
```

**算法**

1. 解析目标 tab（`--tab` 优先；否则 current tab）；默认激活（`--no-focus` 关闭），先激活目标 tab。
2. 校验 `--repeat` 必须显式提供且 ≥ 1（不允许 0）。
3. 执行一次初始 `extract --fields`，建立去重集合；若已达 `--max-items` 直接停止。
4. 重复 `--repeat` 次：
   - 执行 `scroll --by min(scrollBy, viewportHeight)`（默认等待滚动稳定）。
   - `scroll` 返回 `NO_EFFECT` 且 `error.data.atBottom === true` → 停止 `bottom`；否则原样抛错。
   - 否则再次 `extract --fields`，按 `--dedupe-key` 去重，追加新记录。
   - 记录本轮 `{ index, newItems, totalItems, scroll: {before,after,delta}, atBottom }`。
   - 抽取完成后再判断 `atBottom` → 停止 `bottom`（保留最后一屏）。
   - 达到 `--max-items` → 停止 `max-items`。
5. 输出报告。

**参数**

| 参数                         | 默认                                            | 说明                                                      |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `--fields` / `--fields-file` | 必填                                            | 同 `extract --fields`                                     |
| `--repeat <n>`               | **必填（≥1）**                                  | 滚动轮次；必须显式提供，不允许 0                          |
| `--scroll-by <px>`           | 视口 × 0.8                                      | 单次滚动上限不超过视口高度；超出则静默 clamp              |
| `--max-items <n>`            | 10000                                           | 安全上限                                                  |
| `--no-dedupe`                | 关闭（即默认去重）                              | 关闭去重                                                  |
| `--dedupe-key <a,b>`         | 按声明字段推断：`id` > `author,text` > 全部字段 | 去重键；未知字段报 `INVALID_PARAMS`；记录缺键则不参与合并 |
| `--dedupe-prefix <n>`        | 0                                               | 非负整数；仅非 id 字段取前 N 字符参与去重（0 = 全量）     |
| `--no-focus`                 | 关闭（即默认激活）                              | 采集前不激活目标 tab                                      |
| `--json`                     | 关闭                                            | stdout 输出完整 `CollectReport` 对象                      |
| `--jsonl`                    | 关闭                                            | 每条记录一行到 stdout，摘要到 stderr（默认也如此）        |

**输出形状**

```ts
interface CollectReport {
  items: Array<Record<string, string | null>>;
  total: number;
  scrolls: number;
  duplicates: number;
  /** 本轮没有新增记录的轮次数（诊断用，不代表页面缺内容） */
  zeroNewSteps: number;
  stoppedReason: 'repeat-completed' | 'bottom' | 'max-items';
  steps: Array<{
    index: number;
    newItems: number;
    totalItems: number;
    scroll: { before: number; after: number; delta: number };
    atBottom: boolean;
  }>;
  /** 仅当存在可解析的 datetime 字段时输出；仅表示观察到的范围，不承诺完整覆盖 */
  observed?: { newest?: string; oldest?: string };
}
```

- 不输出 `coverage` / `gaps` / `reachedUntil`；`steps` 只描述实际发生的轮次。
- `observed` 是信息性字段；字段缺失/无法解析时省略。
- 退出码：正常停止（repeat-completed / bottom / max-items）为 0；`error` 用现有错误码。
- `--jsonl`：items 逐行到 stdout；`{total, scrolls, duplicates, stoppedReason, observed}` 摘要到 stderr。

**涉及文件**

新增 `packages/server/src/collect.ts`（CLI 编排，不新增 wire 命令）；`packages/server/src/cli.ts`；复用 `extract --fields` 与 `scroll`。测试 `packages/server/src/collect.test.ts`。

**夹具**

新增 `/feed`：虚拟列表（只渲染窗口内 ~10 条），每条有 `data-testid="tweet"`、`time[datetime]`、作者、正文；支持 `n`（条数）与 `dup`（重复渲染）参数。跳项/空窗夹具尚未实现。

**验证**

- 单测：`--repeat` 轮次、去重键/前缀、停止条件、steps/observed 计算、`--jsonl`。
- E2E：`/feed` 上 `--repeat 5`；断言 `scrolls=5`、items 数、`duplicates`、`steps.length`、`stoppedReason`。
- E2E：滚到底部提前停止；后台 tab 由默认 focus 激活后真实滚动。
- 手动：真实 X 时间线 `--repeat 10`，记录 items/scrolls/observed；不宣称覆盖 3 小时。

**完成标准**：固定轮次采集可复现；输出能解释“滚了几次、每轮新增多少、为什么停”，而不是“覆盖了多久”。

### Increment 4 — stdout/stderr 分离

**结果**：`--json` 的 stdout 严格可解析；事件/日志/进度不再污染数据。

**规则**

- stdout：数据（JSON、JSONL、人类可读的数据行）。
- stderr：`📍` 上下文头、`🔔 events`、进度、警告、`run` 的 `#N method`。
- `--json`：stdout 只输出一个 JSON 对象；错误也输出 `{error}` 到 stdout（现状），诊断到 stderr。
- `--quiet`：抑制 stderr 信息（错误仍输出）。
- 移除每条命令后自动打印 events；仅在显式运行 `plt events` 时输出。

**验证**

- E2E：`plt extract --json` 的 stdout 可 `JSON.parse`；stderr 含上下文/警告；`--quiet` 时 stderr 为空（错误除外）。
- E2E：`plt run --json` 每行可解析；日志在 stderr。
- 单测：`--json` / `--quiet` 组合。

**完成标准**：`plt ... --json | jq` 不需要 `2>/dev/null`。

## 5. P1 增量

### Increment 5 — tab 语义统一（current target）

**结果**：server 维护单一 current target；`plt tabs` 同时区分浏览器 active tab 与 current target，避免把两者混为一谈。

**CLI**

- `plt tab <id>`：激活并设置服务端 current tab（后续命令默认目标）。
- `plt tab-new <url>`：新建、激活并设为 current。
- `plt tab-close [id]`：关闭；若关闭 current，服务端清除/回退；`--tab` 与位置参数互斥。
- `plt tabs`：`*` 标记浏览器 active tab，`>` 标记 server current target（可能不同）。
- 不新增 `tab-use` / `tab-focus`。

**实现要点**

- 确保 `activate-tab`/`tab` 的结果回写 server target；补 E2E 验证。
- `close-tab` 后由现有 `tab.removed` 事件清除 target；补时序测试。
- `--tab` 是每命令覆盖；成功命令会把结果 `tabId` 回写为 current（router 行为），后续不带 `--tab` 的命令使用该 tab；浏览器手动激活只更新 fallback，不自动改 current。

**验证**

- E2E：A/B 两个 tab；`tab A` → 无 `--tab` 的 extract 命中 A；`tab B` → 命中 B；`tab-close B` → current 清除/回退。
- 单测：`--tab` + `tab-close <id>` 冲突；target 回写。

**完成标准**：只有一个 `tab` 入口；current target 回写、`plt tabs` 的 active/current 标记有测试锁定。

### Increment 6 — `click-text` 可点击性判定

**结果**：纯文本不参与歧义；只有一个可点击目标时直接执行；多个可点击目标才报错。

**规则**

- 先按文本匹配候选，再分类：
  - **可点击**：`a[href]`、`button`、`input[type=button|submit|reset]`、`select`、`textarea`、`summary`，以及 `role` 为 `button|link|tab|menuitem|option|checkbox|radio|switch` 的元素。
  - **纯文本/容器**：其余元素。
- 若恰好 1 个可点击候选 → 直接点击（即使还有多个文本容器匹配）。
- 若多个可点击候选 → `TARGET_AMBIGUOUS`，错误信息列出数量与前几个候选。
- 若 0 个可点击候选 → `TARGET_NOT_FOUND`（不点纯文本）。
- 覆盖参数：`--within <css>`、`--role <role>`、`--exact`、`--nth <n>`；`--nth` 在可点击候选中选择。

**验证**：单测（纯文本 vs 按钮、多个按钮、within/role/exact/nth）；E2E `/feed` 中按钮 “Following” 与推文正文同名场景。

**完成标准**：不再因为正文里出现同名字符串而误点；真正歧义仍报错。

### Increment 7 — `wait` 增强

**结果**：SPA 切 feed/懒加载后能等到内容真正就绪。

**参数**

- `--count <n>`：匹配数量至少 n。
- `--stable <ms>`：数量/文本在 ms 内不变才算稳定；`condition:'content'` 默认 500ms，selector 模式省略时在达到 count 后立即返回。
- `--condition content`：URL 与 `body` 前 20,000 个归一化字符在 `--stable` 内不变（不涉及 navId）。
- `--selector` 可与 `--count`/`--stable` 组合；`--condition` 与 `--selector` 二选一。
- 返回 `{ matched, waitedMs, stable }`。

**验证**：`/spa` 夹具（延迟渲染/切换 feed）；E2E 等 `article` 数量稳定；单测计数/超时。

**完成标准**：`wait --selector "article" --count 10 --stable 500` 可替代固定 sleep。

### Increment 8 — links/forms 并入 `extract --mode`

**结果**：删除顶层 `links`/`forms` 命令；统一从 `extract --mode links|forms` 访问，同时修复作用域。

**CLI**

```bash
plt extract --mode links --selector "div[role='tablist']" --json
plt extract --mode forms --selector "#login-form" --json
```

- `--selector` 是作用域（与 `extract` 现有语义一致）；`--within` 是同义别名，同时给报错。
- `links/forms` 默认 `visibleOnly=true`；`--all` 关闭；`text/structured/html` 继续用 `--visible-only`。
- `links` 的 `offset/limit` 按 href 分组分页；`forms` 按字段分页。
- 删除 `plt links` / `plt forms`；旧命令直接变成 unknown command，文档给迁移示例。

**协议**

- `ExtractParams.mode` 增加 `links | forms`。
- `ExtractResult` 增加：
  - `{ mode: 'links'; links: LinkInfo[]; total; offset?; limit?; truncated? }`
  - `{ mode: 'forms'; forms: FormInfo[]; total; offset?; limit?; truncated? }`
- 删除 `links` / `forms` 方法：`METHODS`、`paramsSchemas`、`METHOD_META`、`ResultMap`、`router.NEEDS_TARGET`、CLI GROUPS / `printResult` 分支。
- `extract` 的 `fields` 与 `mode` 互斥；`links/forms` 不支持 `fields`。
- `scopedQuery` 保持单一实现；`extract --mode links|forms` 复用它。

**验证**

- 单测：`ExtractResult` union、schema（mode/selector/offset/limit/visibleOnly）、`scopedQuery`。
- E2E：把现有 `links` / `forms` 用例迁移为 `extract --mode`；`/scope` 中 `div[role='tablist']` 只返回 tablist 内链接；虚拟列表重复渲染下 group/count 正确。
- 文档/help 中不再出现 `plt links` / `plt forms`。

**完成标准**：只有一个入口；`links/forms` 命令与 wire method 删除；作用域 bug 有回归测试。

## 6. P2 增量

### Increment 9 — `page-info` 增强

- 增加 `activeElement`（tag/id/role）、`selection` 文本、`document.readyState`、`visibilityState`、`scroll` 快照（x/y/scrollWidth/scrollHeight/clientWidth/clientHeight）。
- 可选 `--selector <css>` 返回该 selector 的 count/box。
- 不带 `--selector` 时保持现有字段兼容。

**验证**：单测 + E2E；`page-info --selector article` 返回 count。

### Increment 10 — `run` 变量与输出传递

- `--var k=v` / 预置 `{"vars": {...}}`；字符串中 `${k}` 替换。
- 每步 `"as": "name"` 捕获 `result.data`；后续直接用 `${name...}` 引用（简单路径）。
- `repeat` / `foreach` 循环先只做设计评估；P2 不强行实现复杂 DSL。
- `--json` 每条命令输出一行 JSON；`--jsonl` 只属于 `collect`，`run` 不支持。

**验证**：单测变量替换/捕获；E2E 一次 run 执行 goto + extract --fields + scroll。

### Increment 11 — `screenshot` 自动聚焦

- `screenshot --selector`：background 自动激活目标 tab 后截图，不再要求用户先 `tab`。
- 可选 `--restore-focus` 恢复原 active tab。
- `--full`（experimental）从 CLI/文档移除；未实现前不再暴露。
- 验证：非 active tab 的元素截图成功；PNG magic 校验。

### Increment 12 — 虚拟列表对抗性 E2E

- `/feed` 增加开关：重复渲染、跳项、空窗、后台 tab。
- 断言：
  - 重复渲染 → `duplicates > 0` 但 items 无重复；
  - 跳项 → `steps` 中出现 `newItems=0`，`stoppedReason` 明确；
  - 后台 tab → 默认 focus 生效；
  - 滚到底部 → `stoppedReason='bottom'`。
- 目标：把“滚了很多次但页面没动”的回归挡住。

## 7. 删除 / 收敛 / 兼容

| 项                                 | 处理                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `scroll` 位置参数（`down 850`）    | **直接删除**；报错并提示 `--by 850` / `--to bottom`。                                                          |
| 每条命令后自动 `🔔 events`         | **删除**；仅显式运行 `plt events`。                                                                            |
| `plt search`                       | **保留**；Google/DDG 搜索继续作为核心命令，不移除。                                                            |
| `tab` / `--tab` / `tab-close <id>` | 保留 `tab` 单一入口；`tab`/`--tab` 写回 current；`plt tabs` 区分 active/current；`tab-close` 与 `--tab` 互斥。 |
| `--mode structured`                | 保留为调试能力；文档不再作为主推 API。                                                                         |
| `extract --prettify`               | 移除；需要美化时用 `--json \| jq .`。                                                                          |
| `screenshot --full`                | 移除/隐藏，未实现前不暴露。                                                                                    |
| `links` / `forms` 顶级命令         | **删除**；并入 `extract --mode links\|forms`，不保留弃用别名。                                                 |
| `scroll` smooth 默认               | 改为 `auto`；`--smooth` 显式开启。                                                                             |
| 只读模式 / 限流识别 / `--delay`    | **不纳入 v5**；不作为产品能力。                                                                                |
| `until-older-than` / `coverage`    | **不纳入 v5**；无法证明完整覆盖，改用 `--repeat` + `observed`。                                                |

**兼容策略**：项目仍是 unstable，**不保证向后兼容**。破坏性变更直接删除，不保留弃用别名/兼容 shim；文档只给迁移示例。旧脚本失败是预期行为。

## 8. 测试与验收

### 每增量门禁

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format:check
```

涉及 CLI/扩展的增量额外跑相关 E2E；协议变更同步 protocol/SKILL 文档。

### 验收矩阵

| 能力             | 单测                     | E2E                                 | 手动                      |
| ---------------- | ------------------------ | ----------------------------------- | ------------------------- |
| scroll 同步      | 解析/返回/NO_EFFECT      | `/tall` 精确 delta、后台 tab、focus | 连续 3 次 scrollY         |
| extract fields   | 语法/attr/fallback/null  | `/feed` 或 `/list` 字段记录         | X 时间线 datetime         |
| collect repeat   | 轮次/去重/steps/observed | `/feed` 固定 repeat、到底停止       | X 时间线 `--repeat 10`    |
| stdout 分离      | `--json`/`--quiet`       | CLI stdout JSON.parse、stderr 诊断  | `plt ... --json \| jq`    |
| tab 语义         | target 回写/冲突         | A/B 切换、关闭回退                  | 多 tab 操作               |
| click-text       | 可点击性/within/role     | 同名文本按钮场景                    | X “Following”             |
| wait             | count/stable/content     | `/spa` 内容就绪                     | 切 feed 后等 article 稳定 |
| links/forms mode | scopedQuery/union        | `/scope` tablist、迁移旧用例        | X tablist                 |
| 虚拟列表对抗     | —                        | 重复/跳项/空窗/后台 tab             | X 时间线                  |

### 真实 X 手动验收

1. `plt goto https://x.com/home`，确认时间线。
2. `plt tab <id>`；后续命令可显式 `--tab`。
3. `plt collect "article[data-testid='tweet']" --fields ... --repeat 10 --dedupe-key author,text --dedupe-prefix 80 --json`。
4. 抽查：`items`、`scrolls`、`duplicates`、`steps`、`observed`、`stoppedReason`。
5. 不宣称“覆盖 3 小时”；只报告实际观察到的范围。
6. 翻页/搜索仍可用 `plt search`，不属于本计划的问题。

**验收结论**：能给出“滚了 N 次、每轮新增多少、共 N 条、去重 D 条、观察范围”的可复现报告。

## 9. 风险与限制

| 风险                         | 影响                       | 缓解                                                          |
| ---------------------------- | -------------------------- | ------------------------------------------------------------- |
| X DOM 选择器变化             | 字段抽取失效               | 推荐 `data-testid`；缺失字段 `null`；夹具可替换               |
| 虚拟列表跳项/重复渲染        | 漏抓或重复                 | 小步滚动（≤视口）、去重、`steps` 记录；不承诺完整覆盖         |
| 后台标签页节流               | scroll 无效                | collect 默认激活；scroll 可 `--focus`；`visibilityState` 警告 |
| 相对时间不可靠               | 时间判断错误               | 强制从 `<time datetime>` 读取；`observed` 仅信息性            |
| `--fields` 分隔符/复杂选择器 | 解析歧义                   | `--fields-file` JSON；转义规则；单测覆盖                      |
| collect 长时间运行           | 阻塞/超时                  | `--repeat`/`--max-items`；固定轮次可中断                      |
| `--repeat` 不保证时间窗口    | 可能多抓或漏抓             | 明确文档：repeat 是轮次，不是覆盖承诺                         |
| 破坏性 CLI 变更              | 旧脚本失败                 | 明确报错 + 迁移表；pre-1.0 集中处理                           |
| `links/forms` mode 作用域    | 误采集                     | 统一 `scopedQuery` + `/scope` 回归夹具                        |
| tab active/current 可分离    | `--tab`/手动切换后可能误判 | `plt tabs` 用 `*`/`>` 分列；`--tab` 仍是每命令覆盖            |

## 10. 未决事项

无。以下决策已全部确认，按计划执行。

## 已确认决策

1. `scroll` 位置参数**直接删除**。
2. settle 默认开启，接受额外等待。
3. 缺失字段默认 `null`。
4. 不做 coverage；**用 `--repeat` 替代 `until-older-than`**。
5. `collect` 默认激活目标 tab 可接受。
6. tab 只保留一个 current target；`plt tabs` 分列浏览器 active 与 server current，避免混淆。
7. `click-text` 歧义可报错，但先按“可点击性”过滤纯文本；只有一个可点击目标时直接执行。
8. **不做只读模式**。
9. **保留 `search`**；上一轮是使用方式问题。
10. 纯经验性问题（限流节奏、账号安全等）不纳入 v5。
11. **`links/forms` 并入 `extract --mode links|forms`**，删除顶层命令。
12. **`run` 只做变量 + `as` 捕获**，`repeat/foreach` 后续再评估。
13. 项目为 unstable，**不保证兼容**；破坏性变更直接删除，不做兼容层。
14. `collect --repeat` **不提供默认值**，必须显式提供且 ≥ 1；不允许 0。
15. `--dedupe-prefix` 默认 **0（全量）**。
16. collect 输出采用 `steps` + `observed` + `zeroNewSteps`。
17. `click-text` 只认语义标签/角色；`onclick` / `tabindex` 容器不算可点击。

## 执行记录

### Increment 1 — scroll 契约（已完成，2026-11-03）

- 协议：`ScrollParams` 改为 `by` / `to` / `selector` / `smooth` / `settle` / `focus` / `allowNoop`；`by` 与 `to` 互斥且必填；新增 `ScrollResult`、`ScrollToResult`、`ScrollMetrics`；新增错误码 `NO_EFFECT`。
- 扩展：默认 `auto`；`--smooth` 才平滑；`settle` 等 2 帧（最多 1s）；返回 `before/after/delta/atTop/atBottom/settled/visibilityState`；后台 tab 返回 `BACKGROUND_TAB`；`delta=0` 报 `NO_EFFECT`（可 `--allow-noop`）；`--focus` 由 background 激活 tab。
- CLI：删除位置参数与 `--direction/--amount`；新增 `--by/--to/--selector/--smooth/--no-settle/--focus/--allow-noop`；`scroll-to` 同步返回 `before/after/delta`。
- 错误数据：`NO_EFFECT` 的 `before/after` 通过 content → background → server 透传。
- 验证：`pnpm typecheck`；`pnpm test`（protocol 39 / server 37 / extension 87）；`pnpm test:e2e` **34 passed**；`pnpm lint` / `pnpm format:check` 通过。
- 偏差：headless Chromium 中后台 tab 仍可能报告 `visible`，因此 `BACKGROUND_TAB` 用单元测试覆盖；`--focus` 用 E2E 验证“激活后再滚动”。

### Increment 2 — extract --fields（已完成）

- `--fields "name=selector[@attr][|fallback]"` / `--fields-file`；`FieldSpec` 走 wire；缺失字段固定 `null`；`@href`/`@src` 绝对化；`fields` 与 `mode/article` 互斥。
- 结果 `{ mode:'fields', items, total, offset?, limit? }`；CLI 默认逐行 JSON，`--json` 为完整信封。
- 验证：extension snapshot 单测、server fields 解析单测、E2E `/list`。

### Increment 3 — collect --repeat（已完成）

- 新增 CLI `collect`（server 侧编排，无新 wire 命令）：`--repeat` 必填 ≥1；默认 focus、去重、`--scroll-by` 视口上限；输出 `items/total/scrolls/duplicates/zeroNewSteps/stoppedReason/steps/observed`。
- 新增 `/feed` 虚拟列表夹具；E2E 覆盖固定轮次、重复渲染去重、底部提前停止。
- `observed` 仅为信息性时间范围，不承诺 coverage。

### Increment 4 — stdout/stderr 分离（已完成）

- 上下文头、`run` 进度、事件提醒、警告改走 stderr；移除自动 `🔔 events`；新增 `--quiet`；`--json` stdout 严格可解析。
- E2E 验证 `--json` + `--quiet`。

### Increment 5 — tab 单一状态（已完成）

- `tab <id>` / `tab-new` 激活并设为 current；`tab-close` 默认当前，关闭 current 后清除/回退；`--tab` + 位置参数冲突报错。
- router 修复 close-tab 后 target 回写竞态。

### Increment 6 — click-text 可点击性（已完成）

- 先按语义标签/role 过滤可点击元素；纯文本不参与；`--within/--role/--exact/--nth`；多个可点击目标才报 `TARGET_AMBIGUOUS`。
- E2E `/mixed-text` 覆盖“正文同名字符串 + 按钮”。

### Increment 7 — wait 增强（已完成）

- `--count` / `--stable` / `--condition content`；返回 `{ matched, waitedMs, stable }`；`selector` 与 `condition` 互斥。
- E2E `/spa` 覆盖数量稳定与内容稳定。

### Increment 8 — links/forms 并入 extract（已完成）

- 删除 `links` / `forms` 顶层命令与 wire methods；`extract --mode links|forms`；`--all` 控制 visibleOnly；`--selector` 作用域。
- 新增 `/scope` 夹具，E2E 验证 tablist 作用域；旧用例迁移到 extract mode。

### Increment 9 — page-info 增强（已完成）

- 增加 `readyState`、`visibilityState`、`activeElement`、`selection`、`scroll` 快照；`--selector` 返回 count/box。
- E2E `/query` 验证。

### Increment 10 — run 变量与捕获（已完成）

- `--var k=v` / 预置 `{"vars":{...}}`；`${name}` / `${as.path}` 替换；`as` 捕获 `result.data`。
- E2E 覆盖变量、`as` 与 `${page.total}`。

### Increment 11 — screenshot 自动聚焦（已完成）

- `screenshot --selector` 自动激活目标 tab；`--restore-focus` 恢复；移除 `--full`。
- E2E 验证非 active tab 元素截图。

### Increment 12 — 虚拟列表对抗性 E2E（已完成，部分）

- `/feed?dup=1` 覆盖重复渲染去重；底部/默认 focus 覆盖停止与激活。
- **未覆盖**：跳项/空窗的强 gap 判断（当前只有 `zeroNewSteps` 诊断，不做覆盖率断言）。

### 最终验证（2026-11-03）

- `pnpm typecheck` ✅
- `pnpm test`：protocol 40 / server 62 / extension 97（199）✅
- `pnpm test:e2e`：**42 passed** ✅
- `pnpm lint` / `pnpm format:check` ✅
- 兼容性：按 unstable 策略直接删除旧 CLI/wire 入口（links/forms、scroll 位置参数、`--prettify`、`screenshot --full`）。

## 附录 A — 现有实现定位

- scroll：`packages/extension/src/dom/actions.ts`（`case 'scroll'`）、`packages/server/src/cli.ts`（scroll 注册与 `printResult`）。
- extract：`packages/extension/src/dom/snapshot.ts`（`extractPage`）、`packages/protocol/src/methods.ts`（`ExtractParams`）。
- links/forms：`packages/extension/src/dom/collect.ts`（`scopedQuery`）、`snapshot.ts`（`extractPage`）、CLI `extract` 注册；并入后删除独立 method。
- tab：`packages/server/src/cli.ts`（`tab`/`tab-new`/`tab-close`）、`packages/server/src/router.ts`（target 回写）、`packages/server/src/target.ts`。
- stdout/stderr：`packages/server/src/cli.ts`（`printResult` 上下文、`run` 进度、`--quiet`）。
- wait：`packages/extension/src/dom/actions.ts`（`waitFor`）。
- E2E：`tests/e2e/support.ts`、`tests/e2e/parklet.e2e.spec.ts`。

## 附录 B — 旧 v5 能力队列（暂缓）

以下原 v5 草案内容不再排入当前 P0/P1/P2；需要时单独评估：

- Shadow DOM open root 深度遍历。
- iframe `frameId` 路由 / `all_frames`。
- 原生对话框停滞提示（不做补丁）。
- 文件上传（DataTransfer 合成 File）。
- 下载观测（`chrome.downloads`）。
- 网络观测 / 真实 networkidle（`chrome.webRequest`）。
- 输入事件真实性（pointer/mouse/beforeinput、contenteditable）。
- 每 tab 串行队列与多 Agent 编排。
- CDP（`chrome.debugger`）专项：真实上传/原生 dialog 精确检测/请求阻断。

理由：这些问题不阻塞“时间线抓取”主任务，且部分需要新增权限或改变默认语义，应在 P0/P1 稳定后再评估。
