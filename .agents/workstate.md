# Workstate

## 当前焦点

v3 增量（`docs/v3-incremental-plan.md`）**已全部实现并验证**，工作区待用户 review 与 commit。

## 状态

- 代码：`eval` 升级（MAIN world + `script` + `NOT_SERIALIZABLE`）、Google snippet、`selection`、`links`、`forms`；`eval` 门控修复（`resolveDisabledCommands`）
- 验证：`pnpm typecheck` / `test`（167：protocol 37 + server 52 + extension 78） / `build` / `lint` 全绿；`pnpm test:e2e` 25 passed
- 版本：protocol/server/extension + manifest 统一 `0.3.0`；`PROTOCOL_VERSION` 仍 `0.1.0-draft`

## 最近完成

- 2026-09-15：v3 增量（未提交）
  - Inc 0 eval 门控修复（显式禁用 > `ENABLE_EVAL` > 默认禁用；`enableEval` 反映最终状态）+ `NOT_SERIALIZABLE`
  - Inc 1 protocol：`selection`/`links`/`forms` 命令/类型/schema/元数据；`eval.expression → script`；集成触点更新
  - Inc 2 eval：`plt eval`（inline/--file/--stdin）；**MAIN world** 执行（隔离世界被 MV3 CSP 恒定阻断，已实测）
  - Inc 3-5 `selection` / `links`（按 href 分组）/`forms`（字段级分页、password 脱敏、labels）
  - Inc 6 Google snippet（多选择器 + 回退，best-effort）
  - Inc 7 文档/版本/E2E（+4 用例）；修复 E2E fixture `page` 事件竞态 + `wait` 单测 flake
- 2026-09-14：平滑工作流修复（提交见 git log）
- 2026-09-11：v2 全部 7 个增量落地并提交

## 下一步

1. 用户 review v3 改动并按需 commit
2. 可选：`links`/`forms` 覆盖 shadow DOM / iframe / 虚拟列表；`selection` 的 `all` 语义
3. 可选：`plt events --follow`、页面级网络事件、`tab.updated`

## 关键约束 / 事实

- `eval` 必须在 **MAIN world**（`chrome.scripting.executeScript`，自包含注入函数）；隔离世界 `new Function` 被扩展 CSP 禁止；MAIN world 仍受**页面 CSP** 限制，严格 CSP 站点会失败
- eval 默认禁用，`PARKLET_ENABLE_EVAL=1` 放行；`PARKLET_DISABLED_COMMANDS` 显式含 `eval` 优先
- `links` 按绝对 href 分组、`forms` 按 form 分组；`forms` 分页为**字段级**；两者 `visibleOnly` 默认 true、采集上限 `MAX_ITEMS=2000` + `truncated`
- `forms` 的 `input[type=password].value` 固定 `'********'`
- PROTOCOL_VERSION 0.1.0-draft（additive 未升）；`eval` 参数由 `expression` 改名 `script` 属 breaking（预发布可接受）
