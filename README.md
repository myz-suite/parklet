# ParkingLot

面向 AI Agent 的浏览器控制基础设施。Agent 通过 CLI（或 HTTP）向 `parkinglot-server` 发命令，server 经 WebSocket 转发到 `parkinglot-extension`（Chrome Manifest V3 扩展），由扩展在真实浏览器中执行 —— 打开网页、点击、输入、滚动、提取内容、截图、搜索、页面内网络请求。

```
┌────────────┐   pl goto https://x   ┌───────────────────┐   WebSocket    ┌─────────────────────┐
│   Agent    │ ────────────────────▶ │  parkinglot-server │ ─────────────▶ │  parkinglot-extension │
│  (LLM)     │ ◀──────────────────── │  (relay 守护进程)   │ ◀───────────── │   (Chrome MV3)       │
└────────────┘   result + context    └───────────────────┘    token 配对   └──────────┬──────────┘
                                                                           真实浏览器页面
```

## 仓库结构（pnpm workspace）

| 包                                             | 说明                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/protocol` (`@parkinglot/protocol`)   | 共享协议：消息信封、命令全集、公共类型、Zod 校验                       |
| `packages/server` (`@parkinglot/server`)       | relay 守护进程：WebSocket 服务端、CLI、会话注册、HITL、命令账本        |
| `packages/extension` (`@parkinglot/extension`) | Chrome MV3 扩展：WebSocket 客户端、content script 执行器、popup 控制台 |

## 前置条件

- Node.js ≥ 20（本仓库使用 pnpm workspace）
- pnpm ≥ 9
- Chrome / Chromium（运行扩展）

## 快速开始

```bash
pnpm install
pnpm typecheck
pnpm test
```

### 端到端使用

```bash
# 1. 启动 relay（打印 pair token）
pnpm --filter @parkinglot/server start
# → parkinglot-server listening on http://127.0.0.1:8787
# → pair token: <hex>

# 2. 构建并加载扩展
pnpm build                     # 产出 packages/extension/dist/
# Chrome → chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → packages/extension/dist
# 打开扩展 popup，填入 server URL 与 token，Save & Connect（状态灯变绿）

# 3. 用 CLI 控制浏览器
pl status                      # extension: connected ✅
pl goto https://example.com    # 自动创建 session；响应带 context 快照
pl extract                     # 提取页面可读文本
pl click-text "Sign in"        # 按可见文本点击
pl scroll down
pl screenshot --path shot.png
pl search "parkinglot"         # 搜索引擎结果
pl fetch https://api.example.com/me --header "Accept: application/json"
pl logs --follow               # 命令账本（敏感字段脱敏）
```

Agent 调用指南见 `parkinglot` skill（`.agents/skills/parkinglot/`）。

## 文档

- `docs/initial-plan.md` — 初始设计与实施计划（架构、协议、命令集、安全模型、HITL、验收标准）
- 协议命令参考将在协议层完成后生成于 `docs/protocol.md`

## 许可证

MIT
