# Workstate

## 当前焦点

v2 手动测试问题（`docs/v2-issues.md`）**已全部修复并验证**，工作区待提交（修复轮未 commit）。

## 状态

- 代码：extract `--article`、extract 分页 total/offset/limit、press（MAIN world keyCode 补丁 + 默认动作）、连接心跳保活
- 新增产物：`packages/extension/src/content-main.ts`（manifest `world:"MAIN"`）、本地 mock（`tests/e2e/support.ts`）
- 验证：typecheck / test（136：34+46+56） / build / lint 全绿；`pnpm test:e2e` 14 passed

## 最近完成

- 2026-09-14：本地 mock + E2E 复现 5 个问题 → 修复 → 全量验证；文档更新（v2-issues 修复记录、protocol.md/zh、README、AGENTS）
  - article：`defuddle` → `defuddle/full`，返回 Markdown + frontmatter（content.js ≈1.1MB）
- 2026-09-11：v2 全部 7 个增量落地并提交（407d0f8）

## 下一步

1. 用户 review 本轮修复并按需 commit
2. `docs/TODO.md` 的 **Code Execution** 仍待设计（Agent 执行页面级代码，尚未设计）
3. 可选：`plt events --follow`、页面级网络事件、`tab.updated`

## 关键约束 / 事实

- press：内容脚本合成事件 + MAIN world keyCode 补丁；仍非可信事件，复杂 IME/编辑器有差异
- `extract --mode` 无 CLI 默认值（article 互斥由 schema `.refine` 保证）
- extract selector 结果：`total` = visibleOnly 过滤后、分页前的第一层元素数
- 连接：扩展每 20s 应用层心跳保活 SW；alarms 仅兜底
- PROTOCOL_VERSION 0.1.0 未提升（预发布）
