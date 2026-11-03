# v3 Incremental Plan — Code Execution & Page Exploration

批准日期：2026-09-15
状态：**已完成并验证**（Increment 0–7 全部落地；执行记录与偏差见文末）
关联文档：`docs/TODO.md`、`docs/v2-incremental-plan.md`、`docs/protocol.md`（symlink 至 `skills/parklet/references/protocol.md`）

## 背景

v2 已全部完成并验证。本 v3 从 `docs/TODO.md` 的四项出发，补齐 Agent 在真实页面上的**执行与探索**能力：

1. **Code Execution**：升级 `eval`（页面脚本执行）
2. **Search result include summary**：补全 Google 解析的 snippet
3. **Text Selection**：新命令 `selection`（程序化选中页面文字）
4. **`links` / `forms`**：两个新命令，枚举页面可见的交互元素与表单元素

所有决策已在对话中逐条确认（含一轮 challenge），随后冻结。

## 决策总览

| #   | 主题           | 决策                                                                                                                                                                                                                                                                                 |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | eval 门控      | 修复 `PARKLET_ENABLE_EVAL=1` 使其真正放行；显式 `PARKLET_DISABLED_COMMANDS` 含 `eval` 优先于 `ENABLE_EVAL`，否则 `ENABLE_EVAL=1` 放行，否则默认禁用                                                                                                                                  |
| 2   | eval 交付面    | 保留 HTTP `/api/command`，**新增 CLI `plt eval`**（string / `--file` / `--stdin`）                                                                                                                                                                                                   |
| 3   | eval 契约      | 入参 `script`（完整脚本，**必须含 `return`**）；**MAIN world**（隔离世界的 `new Function` 被 MV3 CSP 恒定阻断，已实测）、async 包裹；返回 `{ value }`，`undefined` **省略 value**；**以 JSON 往返为唯一可序列化判据**，失败 → 新错误码 `NOT_SERIALIZABLE`；**不兼容旧 `expression`** |
| 4   | selection      | 新命令 `selection`；`selector` 或 `text` 至少其一；返回 `{ text }`；input/textarea 走 `setSelectionRange`；`writeAccess: always`（改变页面选区，仅审计语义）                                                                                                                         |
| 5   | links          | 新命令 `links`；**按解析后的 `href` 分组**；`{ href, texts[], count }`；`selector` 作用域 + `visibleOnly`（默认 true）+ `limit`/`offset`/`total`（**分页单位 = 分组**）+ **采集硬上限 `truncated`**                                                                                  |
| 6   | forms          | 新命令 `forms`；按 `action`/`method`/`target` 分组（无归属控件单独一组）；字段 `tag/type/name/value/labels/checked/selected/disabled/required/id`；`selector` + `visibleOnly`（默认 true）+ **字段级分页** + **采集硬上限 `truncated`**；**password 值脱敏**                         |
| 7   | search snippet | Google 解析补 snippet：多选择器 + 回退，**尽力解析**；文档标注已知限制                                                                                                                                                                                                               |
| 8   | 版本           | 三个 package 与 manifest 统一 `0.2.0 → 0.3.0`；`PROTOCOL_VERSION` 保持 `0.1.0-draft`（additive，未升）                                                                                                                                                                               |

约束：产品未正式发布；`PROTOCOL_VERSION` 为 draft，additive 变更不提升，但**旧 CLI/扩展混用会直接 `INVALID_PARAMS`（`script` 改名）**，文档需写明。

## 契约冻结（wire 形状）

```ts
// 公共类型（packages/protocol/src/types.ts）

export interface LinkInfo {
  href: string; // 解析后的绝对 URL（element.href）
  texts: string[]; // 同一 href 下的文本，DOM 顺序，按精确字符串去重
  count: number; // 该 href 在（visibleOnly 过滤后）结果中的出现次数
}

export interface FormFieldInfo {
  tag: string; // input | select | textarea | button
  type: string; // input.type / 'select' / 'textarea' / button.type
  name?: string;
  value?: string; // 当前值（file 不回传；password 脱敏为 '********'）
  labels: string[]; // label[for] > 包裹 label > aria-label > placeholder
  checked?: boolean; // checkbox / radio
  selected?: string[]; // select 的已选项 value
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

export interface FormInfo {
  action?: string; // 缺省（无 form 归属）为 undefined
  method?: string; // 归一化大写，缺省 GET
  target?: string;
  fields: FormFieldInfo[];
}
```

```ts
// 命令参数 / 结果（packages/protocol/src/methods.ts）

export interface SelectionParams {
  selector?: string; // selector 或 text 至少其一
  text?: string;
}
// Result: { text: string }

export interface LinksParams {
  selector?: string; // 作用域，缺省整页
  offset?: number;
  limit?: number; // 分页单位 = href 分组
  visibleOnly?: boolean; // 默认 true
}
// Result: { links: LinkInfo[]; total: number; offset?; limit?; truncated?: boolean }

export interface FormsParams {
  selector?: string; // 作用域，缺省整页
  offset?: number;
  limit?: number; // 分页单位 = 字段（跨分组扁平计数）
  visibleOnly?: boolean; // 默认 true
}
// Result: { forms: FormInfo[]; total: number; offset?; limit?; truncated?: boolean }
//   total = 字段总数；每个分组携带各自字段的切片；表单分组本身不单独分页

export interface EvalParams {
  script: string; // 完整脚本，必须包含 return
}
// Result: { value?: unknown }（undefined 时省略 value）
```

错误码新增：`NOT_SERIALIZABLE`（`packages/protocol/src/errors.ts`，归入“执行层”）。

## 参数语义

- **visibleOnly（links / forms）**：默认 `true`；过滤 links 锚点 / forms 字段中不可见元素；显式 `false` 可关闭。
- **采集硬上限（challenge 修订）**：links/forms 在**采集阶段**设硬上限（`MAX_ITEMS = 2000`，按 DOM 顺序短路）；分页发生在采集之后，故 `limit` **不**减少采集工作。超限时设置 `truncated: true`。
- **links 分组**：以 `element.href`（绝对化、含 query/fragment）为 key；同 key 合并 `texts`（DOM 顺序、精确去重），`count` 累加。分页作用在**分组列表**上，`total` = 分组数。
- **links scheme 过滤（默认提案，待确认）**：保留可解析的 `http/https/mailto/tel`；丢弃空 `href`、`#` 锚点、`javascript:`。
- **forms 分组 + 字段级分页（challenge 修订）**：按 `action|method|target` 归一化 key 分组；不归属任何 `<form>` 的控件归入 `action=undefined` 的组。**分页单位 = 字段**（跨分组扁平计数），`total` = 字段总数；每个分组只携带落在 `[offset, offset+limit)` 区间内的字段（分组按首次出现顺序）。分组自身不单独分页。
- **forms 敏感值（challenge 修订）**：`input[type=password]` 的 `value` 固定返回 `'********'`（不回传真实值）；`file` 不回传内容。
- **labels 优先级**：`label[for]` > 包裹 `label` > `aria-label` > `placeholder`。
- **selection 定位**：`selector` 走 `findByCss`；`text` 走 `findByText`（歧义报 `TARGET_AMBIGUOUS`）。input/textarea 用 `setSelectionRange`（`select()` 语义），其余用 `Range` + `Selection`。

## 增量顺序

```
0 (eval 门控 + 契约冻结) → 1 (Protocol) → 2 (eval)
                                      ↘ 3 (selection)
                                      ↘ 4 (links) → 5 (forms) → 6 (snippet) → 7 (docs/版本/E2E)
```

- Increment 0/1 是所有后续的基础
- Increment 2（eval）依赖 0/1
- Increment 3/4/5/6 依赖 1，彼此独立，可与 2 并行
- Increment 7 依赖所有代码增量

### Increment 0: eval 门控修复 + 契约冻结

**结果**：`PARKLET_ENABLE_EVAL=1` 按文档生效；eval 的参数/返回/错误契约冻结。

**变更**

- `packages/server/src/config.ts`：重写门控判定（建议新增纯函数 `resolveDisabledCommands(env)` 便于单测）：
  1. `PARKLET_DISABLED_COMMANDS` 显式包含 `eval` → 禁用（最高优先）
  2. 否则 `PARKLET_ENABLE_EVAL=1` → 从禁用列表移除 `eval`
  3. 否则默认禁用（禁用列表回填 `eval`）
  - **breaking 安全修复（challenge 修订）**：现状下 `PARKLET_DISABLED_COMMANDS` 为**非空且不含 eval** 时会隐式放行 eval；新逻辑改为默认禁用。此行为变更需显式记录，并在文档/README 更新说明。
- `packages/protocol/src/errors.ts`：新增 `'NOT_SERIALIZABLE'`
- 冻结 eval 契约（见上）

**验证**：`pnpm --filter @parklet/server test`（新增 `config.test.ts` 用例：显式禁用优先 / `ENABLE_EVAL` 放行 / **非空列表不含 eval 时仍默认禁用** / 空列表默认禁用）+ `pnpm --filter @parklet/protocol typecheck`

### Increment 1: Protocol 层更新

**结果**：三个新命令与 eval 新参数进入协议，两端可校验。

**变更**

- `packages/protocol/src/types.ts`：`LinkInfo` / `FormFieldInfo` / `FormInfo`
- `packages/protocol/src/methods.ts`
  - `METHODS` 增 `'selection'` / `'links'` / `'forms'`
  - `ParamsMap` / `ResultMap` 增三项；`EvalParams.expression → script`
  - `METHOD_META`：`selection` = `always`（改变选区）、`links`/`forms` = `never`；`eval` 保持 `always`
- `packages/protocol/src/schemas.ts`：新增三个 params schema（`selection` 加 `.refine` 至少一个定位字段）；`eval: { script: string.min(1) }`
- `packages/protocol/src/envelope.ts`：无变更（事件不变）

**集成触点清单（易漏，必须逐项核对）**

- `packages/server/src/router.ts:34` `NEEDS_TARGET` 增 `selection` / `links` / `forms`
- `packages/server/src/cli.ts:848` `GROUPS` 增三项分类
- `packages/server/src/cli.ts:174` `printResult` 增三分支 + `eval` 分支
- `packages/server/src/cli.ts:143` `exitCodeFor` 增 `NOT_SERIALIZABLE`（challenge 修订；否则落到退出码 1）
- `packages/server/src/ledger.ts:36` `SENSITIVE_KEYS`：`expression → script`
- `packages/server/src/router.test.ts:85` 旧 `expression` 用例改 `script`
- 对外文档：`skills/parklet/references/protocol.md`（= `docs/protocol.md`）、`skills/parklet/SKILL.md`

**验证**：`pnpm --filter @parklet/protocol test` + `pnpm typecheck`

### Increment 2: eval 升级

**结果**：Agent 可通过 `plt eval` / HTTP 在页面隔离世界执行一段脚本并取回序列化结果。

**变更**

- `packages/extension/src/dom/actions.ts`（`case 'eval'`，现 `:494`）：
  - 保留隔离世界、`"use strict"`；包成 `async () => { ...script... }` 并 `await` 返回值
  - 返回前以 **JSON 往返为唯一判据**（challenge 修订）：`JSON.parse(JSON.stringify(value))` 成功才放行；失败（BigInt/循环引用/含函数与 DOM 节点导致的序列化问题）→ 抛 `NOT_SERIALIZABLE`。注意 `Map/Set` 会静默变 `{}`、`Date` 变字符串——接受该 JSON 语义
  - `undefined` → 返回 `{}`（省略 `value`）；其余放 `{ value }`
- `packages/server/src/cli.ts`：新增 `plt eval` 子命令（位置参数 string，或 `--file <path>` / `--stdin`；三者互斥）与 `printResult` 分支
- `packages/server/src/config.ts`：由 Increment 0 提供门控；`plt serve` 文档提示 `PARKLET_ENABLE_EVAL=1`

**验证**：`packages/extension/src/dom/actions.test.ts`（多语句 + return、await、undefined、不可序列化报错）+ `router.test.ts` + 手动 `plt eval --help`

### Increment 3: selection

**结果**：`plt selection` 按 selector 或可见文本选中页面文字并返回文本。

**变更**

- `packages/extension/src/dom/actions.ts`：新增 `case 'selection'`
  - 复用 `findByCss` / `findByText`（`packages/extension/src/dom/locator.ts`）
  - `input` / `textarea` → `el.focus()` + `el.select()`（`setSelectionRange`）；其余 → `Range.selectNodeContents` + `getSelection().addRange()`
  - 返回 `{ text }`（折叠/空白选区返回空串）
- `packages/server/src/cli.ts`：`plt selection`（`--selector` / `--text`，二选一）
- `packages/protocol/src/schemas.ts`：`.refine` 保证 `selector` / `text` 至少其一

**验证**：`actions.test.ts`（selector 选中、文本选中、input/textarea、歧义 `TARGET_AMBIGUOUS`）

### Increment 4: links

**结果**：`plt links` 枚举可见链接，按 href 分组。

**变更**

- 新增 `packages/extension/src/dom/collect.ts`：`collectLinks(doc, params)`
  - `querySelectorAll('a[href]')`（含 selector 作用域）→ 过滤 `visibleOnly` → scheme 过滤 → **采集硬上限 2000 短路** → 按 `href` 分组
  - 分页作用在分组列表；返回 `{ links, total, offset?, limit?, truncated? }`
- `packages/extension/src/dom/actions.ts`：新增 `case 'links'` 调 `collectLinks`
- `packages/server/src/cli.ts`：`plt links [--selector] [--limit] [--offset] [--all]`（`--all` = `visibleOnly:false`）

**验证**：`collect.test.ts`（分组/去重/count/可见过滤/scheme 过滤/分页 total/`truncated`）+ **真实浏览器 E2E 1 条**（challenge 修订：happy-dom 的 `element.href` 相对解析与 visibility 不可靠，见 `locator.ts:16`）

### Increment 5: forms

**结果**：`plt forms` 按 form 分组枚举字段。

**变更**

- `packages/extension/src/dom/collect.ts`：`collectForms(doc, params)`
  - 遍历 `input/select/textarea/button`（含 `form` 归属）→ labels 解析 → 字段归一化（**password 脱敏**）→ 按 `action|method|target` 分组 → **采集硬上限 2000 短路**
  - **字段级分页**：跨分组扁平计数 `offset`/`limit`，`total` = 字段总数；每组只带落在区间内的字段（分组按首次出现顺序）
  - 返回 `{ forms, total, offset?, limit?, truncated? }`
- `packages/extension/src/dom/actions.ts`：新增 `case 'forms'`
- `packages/server/src/cli.ts`：`plt forms [--selector] [--limit] [--offset] [--all]`

**验证**：`collect.test.ts`（labels 优先级、勾选/选中态、disabled/required、无归属分组、**字段级分页跨分组**、`truncated`、password 脱敏）+ **真实浏览器 E2E 1 条**

### Increment 6: Google snippet

**结果（challenge 修订，重述为可验证）**：`parseSearchResults` 的 Google 分支新增 **多选择器 + 回退链**的 snippet 解析，并以 mock 单测证明；**线上效果为 best-effort，不承诺一定命中**（Google DOM 会变动）。

**变更**

- `packages/extension/src/dom/actions.ts` `parseSearchResults`（`:573`）：
  - Google 分支为每条结果补 snippet：主选择器 + 回退链，取不到则省略（不报错）
  - 保持 DuckDuckGo 分支现状
- 文档标注“尽力解析，Google DOM 变动可能导致 snippet 缺失”

**验证**：`actions.test.ts` 用 Google 结果页 mock（含多布局 fixture 与“全部取不到时省略”用例）；真机 `plt search` 手动确认（允许失败，记录结果）

### Increment 7: 文档、版本与收尾

**变更**

- `skills/parklet/references/protocol.md`（= `docs/protocol.md`）：新增三命令、eval 新语义、`NOT_SERIALIZABLE`、集成说明
- `skills/parklet/SKILL.md`：命令表补 `eval` / `selection` / `links` / `forms`
- `README.md`、`skills/parklet/references/example.md`、`AGENTS.md`：同步
- `packages/*/package.json` + `packages/extension/manifest.json`：`0.2.0 → 0.3.0`
- `docs/TODO.md`：勾掉四项

**验证**：审阅一致性 + `git grep -nE "expression"` 无遗留（除历史文档）+ `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format`

## 每增量完成后检查

```
pnpm typecheck && pnpm test && pnpm lint && pnpm format
```

## 最终验证

- 全量：`pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format`
- E2E：`pnpm test:e2e`（新增 links/forms/selection/search-snippet 的 mock 用例）
- 手动：`plt --help` 命令列表；`PARKLET_ENABLE_EVAL=1 plt eval "return document.title"`

## 未决事项

- `links` 的 scheme 过滤默认（提案：保留 http/https/mailto/tel，丢弃空 href / `#` / `javascript:`）
- `selection` 是否需要 `all`（全选）语义
- shadow DOM / iframe / 虚拟列表不覆盖（文档标注）

## 执行记录与偏差（2026-09-15）

Increment 0–7 全部落地。验证：`pnpm typecheck` / `pnpm test`（167 单测：protocol 37 / server 52 / extension 78）/ `pnpm build` / `pnpm lint` 全绿；`pnpm test:e2e` **25 passed**。

| #   | 增量           | 结果                                                                                                                                                |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | eval 门控      | `resolveDisabledCommands()`（显式禁用 > `ENABLE_EVAL` > 默认禁用）；`enableEval` 改为反映最终可用状态；新增 `NOT_SERIALIZABLE`                      |
| 1   | Protocol       | `selection`/`links`/`forms` 命令、类型、schema、METHOD_META；`eval.expression → script`；集成触点（NEEDS_TARGET/GROUPS/exitCodeFor/redact）全部更新 |
| 2   | eval           | `plt eval`（inline/`--file`/`--stdin`）；**改为 MAIN world 执行**（见偏差 1）                                                                       |
| 3   | selection      | `plt selection`（selector/可见文本；input 用 `setSelectionRange`，其余 `Range`+`Selection`）；返回 `{ text }`                                       |
| 4   | links          | `dom/collect.ts` `collectLinks`：按绝对 href 分组（`texts[]`/`count`）、scheme 过滤、可见过滤、采集上限、按组分页                                   |
| 5   | forms          | `collectForms`：按 form 分组、字段级分页、labels 优先级、password 脱敏、勾选/选中态、采集上限                                                       |
| 6   | Google snippet | `parseSearchResults` Google 分支多选择器 + 回退（best-effort），单测覆盖                                                                            |
| 7   | 文档/版本      | protocol.md/SKILL/README/example.md/AGENTS 同步；包与 manifest `0.3.0`；TODO 勾除；E2E +4 用例                                                      |

执行期偏差/补充：

1. **【重大】eval 执行世界由 isolated 改为 MAIN（challenge 未预见）**：E2E 暴露隔离世界 `new Function` 被 MV3 **扩展 CSP** 恒定阻断（`unsafe-eval` 不允许）；隔离实验证实 `ISOLATED` 必失败、`MAIN` 可用。故 `eval` 移到 `chrome.scripting.executeScript({ world: 'MAIN', func })`（函数自包含注入）。代价：MAIN world 仍受**页面 CSP** 约束，严格 CSP 站点会返回注入失败错误；文档已写明。用户确认“接受，保持默认禁用”。参数/返回契约不变。
2. **eval 单测移至 E2E**：注入函数必须自包含（Chrome 序列化函数体，无法 import），故移除 `actions.test.ts` 的 eval 单测，改由 E2E 覆盖（多语句返回值 + 不可序列化）。
3. **`enableEval` 语义修正**：由“读 env 原值”改为“eval 最终是否可用”，避免 status 说谎（显式禁用 + `ENABLE_EVAL=1` 时报 false）。
4. **E2E fixture 竞态修复**：`create-tab` 后原用 `waitForEvent('page')` 与页数判断存在竞态 → 改为 `context.pages()` 差集轮询（20s）。（既有 flake，非本次功能引入。）
5. **`actions.test.ts` wait 用例加固**：原 setTimeout 在测试结束后写 DOM 触发 unhandled error（既有 flake）→ 改为轮询等待新元素出现 + `clearTimeout`。
6. **links scheme 过滤**按默认提案实现：保留 `http/https/mailto/tel`，丢弃空 `href`/纯 `#`/`javascript:`。
7. **包版本**：protocol/server/extension 与 manifest 统一 `0.2.0 → 0.3.0`；`PROTOCOL_VERSION` 保持 `0.1.0-draft`。
8. **既有外部网络 flake**：`goto 驱动真实页面` 依赖 example.com→iana.org，偶发超时（重跑通过），与本次改动无关。

## Challenge 修订记录（2026-09-15）

对 `docs/v3-incremental-plan.md` 草案做了一轮 challenge，确认并落实以下修订：

1. **eval 序列化判据改为 JSON 往返**（原计划 `structuredClone` + JSON 口径错误）：`structuredClone` 可克隆 BigInt/Map/Set，但 JSON 传输会抛错或丢字段。现以 `JSON.parse(JSON.stringify(value))` 为唯一判据；`Map/Set`→`{}`、`Date`→字符串为可接受的 JSON 语义。
2. **forms 分页改为字段级**（原按分组）：多数页面仅 0–2 个 `<form>`，分组级分页形同虚设、无法阻止巨型单表。现跨分组扁平计数，`total` = 字段总数。
3. **links/forms 加采集硬上限**（`MAX_ITEMS=2000`，DOM 顺序短路 + `truncated`）：分页在全量采集之后，`limit` 不减少工作量；避免大页面卡顿/超时。
4. **forms password 值脱敏**：`input[type=password]` 固定返回 `'********'`。
5. **Increment 0 明确为 breaking 安全修复**：非空 `PARKLET_DISABLED_COMMANDS` 不含 eval 时，从“隐式放行”改为“默认禁用”，加测试覆盖。
6. **集成清单补 `cli.ts:143 exitCodeFor`**：否则 `NOT_SERIALIZABLE` 落到退出码 1。
7. **Increment 6 结果重述为 best-effort**：mock 单测证明解析器，线上不承诺命中。
8. **links/forms 各加 1 条真实浏览器 E2E**：happy-dom 的 `element.href` 相对解析与 `getComputedStyle`（`locator.ts:16`）不可靠。
9. **识别（不阻断）**：`METHOD_META.writeAccess` 无运行时消费，`selection='always'` 仅为审计语义。
