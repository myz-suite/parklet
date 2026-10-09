# Parklet — Chrome Web Store 发布计划（release-plan）

> 目的：把 `parklet-extension` 作为 Chrome 扩展发布到 Chrome Web Store（CWS）前，需要完成的工作与准备素材清单。
> 适用：仓库根 `packages/extension`。当前 manifest 版本：`0.2.0`（`manifest.json`）。

发布前请确认：**本清单不涉及功能开发**——默认扩展功能已稳定（真实 Chrome 端到端验证通过）。以下全部是商店上架的工作项。

---

## 1. 概述与前置条件

Parklet 扩展的定位：**配套组件**——需要配合用户本机运行的 `parklet-server`（relay）使用；单独安装扩展没有用途。这直接影响商店描述与审核口径（详见 §5 文案）。

前置条件：

- [ ] **Chrome 开发者账号**：访问 <https://chrome.google.com/webstore/devconsole> → 注册开发者账号（一次性 **US$5 注册费**），完成邮箱与付款验证
- [ ] 决定发布名与开发者主体（个人/组织；描述与隐私政策落款需一致）
- [ ] 确认目标：**公开**（所有人都能安装）还是 **非公开/受信任测试者**（先用内部测试，后转公开）——建议首轮先走"受信任测试者"

---

## 2. 素材准备清单

> 每一项标注了规格与出处。打勾表示已完成。方括号 `[...]` 内是需要你提供的信息。

### 2.1 必填素材

| 素材               | 规格                                                       | 状态 | 备注                                                                                      |
| ------------------ | ---------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| 扩展名称           | ≤ 30 字符建议；显示名                                      | [ ]  | 建议 "Parklet — Agent Browser Bridge"（与 manifest `name` 一致或更友好）               |
| 简短描述           | 前 132 字符（列表页展示）                                  | [ ]  | 见 §5.1 草稿                                                                              |
| 详细描述           | ≤ 4000 字符                                                | [ ]  | 见 §5.2 草稿                                                                              |
| 分类 Category      | 单选                                                       | [ ]  | 建议 **Developer Tools**（另可选 "Productivity"）                                         |
| 语言 Language      | 单选                                                       | [ ]  | English（zh 版本描述后续可加）                                                            |
| 图标 icon          | **128×128 PNG**（方形）                                    | [ ]  | 需要设计一个 "🅿 Parklet" 主题图标；不可含商店外品牌/商标                               |
| 主截图 Screenshots | **至少 1 张**，最多 5 张；建议 1280×800 或 640×400 PNG/JPG | [ ]  | 用真实运行画面：popup 连接态、CLI 会话、浏览器操作示例（可用 `plt screenshot` 截取演示页） |
| 开发者邮箱         | 账号注册邮箱                                               | [ ]  | 用于商店联系；建议建 `support@<你的域名>` 并置入隐私政策                                  |
| 隐私政策 URL       | 需可公开访问的页面                                         | [ ]  | 无官网时可先用 GitHub Pages / gist 托管；内容模板见 §5.3                                  |

### 2.2 可选素材（提升转化）

| 素材                      | 规格           | 状态 | 备注                                             |
| ------------------------- | -------------- | ---- | ------------------------------------------------ |
| 宣传图片 Promotional tile | 440×280 PNG    | [ ]  | 非必需                                           |
| 小型宣传图 Marquee        | 1400×560 PNG   | [ ]  | 非必需                                           |
| 视频                      | YouTube 链接   | [ ]  | 演示 1–2 分钟（可后续补）                        |
| 多语言描述                | 按 locale 上传 | [ ]  | zh-CN 描述可从 §5.2 中文改写（存为扩展副本文档） |

### 2.3 内容素材生成建议

- 截图素材可用本仓库 `plt screenshot` 能力产出真实画面；
- 建议一个演示流程脚本（存 `scripts/demo.sh`）：`goto → extract → click-text → scroll → screenshot`，方便每次发版前重截图。

---

## 3. 权限与审核项（提交前必须自查）

扩展当前 manifest 权限：

```
permissions: tabs, scripting, webNavigation, storage, alarms
host_permissions: <all_urls>
```

CWS 审核重点：**每项权限都要在"权限理由（justification）"中说明用途**。

| 权限                          | 用途（审核理由文案）                                                         | 风险                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `host_permissions <all_urls>` | 核心功能：在用户指定的任意页面执行 Agent 命令（点击/提取/滚动/页面内 fetch） | **高敏感**——描述与理由必须说明这是"agent 控制浏览器"的固有需要，并说明仅在用户主动发起命令时访问页面 |
| `tabs`                        | 列举/激活/新建/关闭标签页；读标题与 URL（会话寻址）                          | 中——与 `<all_urls>` 一并披露                                                                         |
| `scripting`                   | 注入 content script（页面加载后执行命令）                                    | 低                                                                                                   |
| `webNavigation`               | 追踪导航以维护 navId（页面上下文连续性）                                     | 中——披露：记录导航事件，仅本地                                                                       |
| `storage`                     | 保存 server URL 与配对 token（`chrome.storage.local`）                       | 低——本机存储，不传输                                                                                 |
| `alarms`                      | service worker 保活（Chrome 空闲回收后重连 server）                          | 低                                                                                                   |

审核自查项：

- [ ] **无远程代码**：MV3 禁止远程托管/执行 JS——本扩展由 esbuild 全部打包进 `dist/`（background.js/content.js/popup.js 内联依赖），符合
- [ ] **无混淆代码**：产物体积小、可读（若压缩需在提交说明里附解混淆说明——当前未压缩）
- [ ] **最小权限确认**：`eval` 不在 manifest（代码含但服务端默认禁用，见 §3.1 说明）
- [ ] **单用途声明**：商店要求填写"单用途说明"（single purpose）——文案见 §5.4
- [ ] **数据使用声明**：商店"隐私"页勾选"不收集或传输任何用户数据"（本扩展无网络遥测；WS 仅连用户自配的 `127.0.0.1` relay）
- [ ] **测试说明**：审核员可能无法理解功能——在提交备注里附 `README` 的"使用指南"链接或截图流程，说明需配合本机 server

### 3.1 关于 `eval` 的披露策略

代码含 `eval` 执行能力（服务端 `PARKLOT_ENABLE_EVAL=1` 才开启，默认 `disabledCommands` 含 `eval`）。建议：

- [ ] 商店描述说明 "arbitrary JS execution is disabled by default and requires explicit opt-in on the user's own server"（诚实披露，降低审核误判为远程代码风险）

---

## 4. 构建与打包（每次发版重复）

```bash
# 1. 全部构建
pnpm build                       # server/protocol + extension esbuild

# 2. 确认产物
ls packages/extension/dist/      # manifest.json, background.js, content.js,
                                 # popup.html, popup.css, popup.js (+ .map)
```

打包步骤：

- [ ] 清理 `dist/` 中的 `*.map`（如需发布 sourcemap 可选保留；发布包建议去除以减小体积并避免暴露源码结构——评估后决定，保持一致）
- [ ] 核对 `manifest.json`：`version` 递增（SemVer，见 §7）；`name`/`description` 与商店一致；`minimum_chrome_version` 建议声明（依赖 `chrome.alarms` 0.5min → Chrome ≥ 120；可写明以阻止旧版本安装）
- [ ] 压缩（**zip 根必须直接含 manifest.json**，不能带 dist/ 前缀）：`cd packages/extension/dist && zip -r ../parklet-extension-<version>.zip . -x "*.map"`（`-x "*.map"` 排除 sourcemap，产物更小）
- [ ] 用 CWS Developer Dashboard 上传 zip

> 构建一致性：`pnpm build` 需在干净 checkout 上通过；发版前跑 `pnpm test`（102 用例）与 `pnpm lint`。

---

## 5. 商店文案草稿（可直接复制）

### 5.1 简短描述（≤132 字符）

> Let an AI agent drive your own Chrome browser — open pages, click, type, extract content, screenshot, search and fetch with your real login state, through a local relay.

### 5.2 详细描述（草稿骨架，≤4000 字符；按需补充截图说明）

```
Parklet lets an AI agent (or you, from the command line) control your real Chrome
browser with simple commands, while everything runs locally on your machine.

What it does
- Navigate: goto / back / forward / reload
- Interact: click by CSS selector or visible text, fill forms, type, press keys,
  hover, select dropdown options
- View & extract: scroll, screenshot, readable page text with context
- Web in the real session: search engines, and page-context network requests that
  carry your login state
- Tabs: list, switch, open and close tabs

How it works
- Install this extension and pair it with a local parklet-server (run with
  Node.js on your own computer, pnpm --filter @parklet/server start)
- Control it with the plt CLI or the /api HTTP endpoints
- Every response carries a page context snapshot (url/title/navId), so an agent
  can always tell whether the page changed

Privacy & security
- This extension does NOT collect or transmit any user data
- It connects only to a relay you run yourself on 127.0.0.1, authenticated with a
  pairing token
- The broad <all_urls> permission is required to execute commands on whatever page
  you point it at; commands run only when you (or your agent) send them
- Arbitrary JS execution (eval) is disabled by default and requires explicit opt-in
  on your own server

Getting started
1. Start the relay: pnpm --filter @parklet/server start
2. Load dist/ unpacked, or install this package and pair the token in the popup
3. plt status → connected; plt goto <url>; plt extract; ...

Full protocol & CLI reference: repository README (docs/protocol.md).
```

### 5.3 隐私政策模板（托管为公开 URL 后填入）

要点：收集什么（无）、本地存储（server URL/token 在 chrome.storage.local）、网络连接（仅到用户自配的 127.0.0.1 relay）、第三方（无）、删除（卸载即清除）、联系方式（你的邮箱）。可直接套用 §5.2 的 Privacy 段扩写成一页。

### 5.4 单用途说明（审核表单）

> Parklet 的唯一用途是让用户（或用户授权的 AI agent）通过本地 relay 命令，在用户自己的 Chrome 会话中执行浏览器操作（导航、交互、提取、截图、搜索与带登录态的页面内请求）。它不收集遥测、不展示广告、不含任何远程内容。

---

## 6. 上传与发布选项

- [ ] 打开 Developer Dashboard → **Add new item** → 上传 §4 的 zip
- [ ] 填写 §2/§5 素材：图标、截图、描述、分类、语言、隐私政策 URL、权限理由、单用途说明
- [ ] 隐私实践：勾选 "Single purpose" 声明；数据收集选 **"No personal data collected"**
- [ ] 发布选项建议首轮选 **受信任测试者**（Trusted testers）→ 添加你的 Google 账号 → 获取测试链接验证安装
- [ ] 测试通过后 **提交审核**（Publish → Submit for review）

时间预期：新账号首次审核通常 1–7 个工作日；被拒（feedback）后按 §3 自查修改重提。

---

## 7. 发布后维护

- [ ] **版本管理**：每次改动 `packages/extension/manifest.json` 的 `version`（semver）并重建 zip；仓库建议配合 `CHANGELOG.md`（Keep a Changelog 风格）
- [ ] **一致性**：商店描述/截图若提到 CLI，记得与 `docs/protocol.md`、`README.md` 同步
- [ ] 迭代建议：收集问题走 GitHub Issues（或你所在平台），发布周期可按需
- [ ] 若扩展长期未更新，CWS 会要求重新确认权限与隐私声明——收到通知后按 §3 复核

---

## 8. 你需要提供/完成的项（外部输入汇总）

1. Chrome 开发者账号注册（US$5）与验证
2. 128×128 图标设计（可给 AI 出图或外包）
3. 主截图 1–5 张（可用仓库 `plt screenshot` 产出演示画面）
4. 隐私政策托管 URL + 支持邮箱（建议 `support@` 你的域名）
5. 首次发布走"受信任测试者"或直接公开的决策
6. 商店名/开发者主体落款

> 一旦以上素材就位，第 2/3/4/5 节可由仓库内文档 + 构建脚本在 ~30 分钟内完成打包与提交表单填写。
