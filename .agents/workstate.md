# Workstate

## 当前焦点

v2 增量计划**已全部执行并验证完成**（7 个 increment）；工作区处于待提交状态。

## 状态

- 计划：`docs/v2-incremental-plan.md` 标记「已完成并验证」，含执行记录与偏差
- 代码：I1–I7 落地（HITL 移除、extract/article、元素截图、press 组合键、tab 回退、事件缓存、CLI 更新）
- 验证：typecheck / test（130） / build / lint 全绿；`pnpm test:e2e` 9 passed；`plt --help` / symlink 入口已核对

## 最近完成

- 2026-09-11：计划二轮修正（9 项）→ 执行全部 7 个增量 → 文档对齐 → 全量验证 + E2E 通过

## 下一步

1. 用户 review 代码变更（42 文件改动）并按需提交（未获指示不提交）
2. 可选后续：`plt events --follow`、页面级网络事件、`tab.updated`
3. 如需减小扩展体积：esbuild 开 minify 或 defuddle 精简入口（content.js 当前 ≈535KB）

## 关键约束 / 事实

- PROTOCOL_VERSION（0.1.0）未提升；`unreadCount` 属未升版本 wire 变更（预发布，已接受）
- 回退语义：`resolve()` 同步；tabId=undefined → 回退 `latestTabId` 并重绑，无则 `EXTENSION_NO_TAB`；失败命令不重试
- tab 失效错误码 = `SESSION_TAB_CLOSED`（扩展 dispatch 层映射），`TAB_NOT_ACTIVE` 不触发回退
- structured 截断 = BFS，`maxNodes=500`（固定常量）；单 root 取子元素为第一层
- 文档对齐主文件 = `skills/parkinglot/references/protocol.md`（`docs/protocol.md` 为其 symlink）+ `protocol.zh.md`
- defuddle 为 CJS/UMD：`snapshot.ts` 用显式构造器类型收窄默认导入
