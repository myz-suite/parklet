> **修复状态（2026-09-14）**：下方问题已全部定位并修复，配套本地 mock + E2E 复现/回归。根因、修复与测试见文末「修复记录」。

## 已验收的

- ✅ plt events 能够查询事件列表。有事件也能可以在其他命令的输出里看到。
- ✅ cli 能够正常工作。
- ✅ type（输入） 的智能解析基本上能工作
- ✅ tab 回退基本能正常工作

## Extract Article 有问题

```
➜  ~ plt extract --article
✖ [INVALID_PARAMS] invalid params for 'extract': extract 的 article 与 mode 互斥（article=true 时不可同时提供 mode）
```

## Limit Offset 没能返回 Total 或者对应的参数

```
➜  ~ plt extract --mode structured --selector "article ul" --limit 10
📍 https://wiki.kimleo.net/articles/%E6%96%87%E7%AB%A0%E5%88%97%E8%A1%A8/ — 文章列表 - Kimmy's Wiki (navId=2, tab=1854130533, session=pl-3c60af04)
[{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../LLM%20Chronicles%20Talk/","title":"LLM Chronicles Talk"},"children":[],"text":"LLM Chronicles Talk"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../agent/Agent%20Series/","title":"Agent Series"},"children":[],"text":"Agent Series"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../2024%E5%B9%B4%E4%BD%A0%E5%A6%82%E4%BD%95%E4%BD%BF%E7%94%A8AI/","title":"2024年你如何使用AI"},"children":[],"text":"2024年你如何使用AI"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E4%B8%80%E6%AC%A1%E5%A4%B1%E8%B4%A5%E7%9A%84%E8%BF%87%E5%BA%A6%E6%8A%BD%E8%B1%A1/","title":"一次失败的过度抽象"},"children":[],"text":"一次失败的过度抽象"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E5%9F%BA%E4%BA%8E%E5%BD%A2%E5%BC%8F%E5%8C%96%E9%AA%8C%E8%AF%81%E7%9A%84%E6%B3%A8%E9%87%8A/","title":"基于形式化验证的注释"},"children":[],"text":"基于形式化验证的注释"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../Accumulator-passing%20style","title":"Accumulator-passing style"},"children":[],"text":"Accumulator-passing style"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E5%B7%A5%E5%85%B7%E4%BE%9D%E8%B5%96/","title":"工具依赖"},"children":[],"text":"工具依赖"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E7%A6%BB%E5%BC%80%E7%9F%A5%E4%B9%8E%E8%BF%99%E4%B8%80%E5%B9%B4/","title":"离开知乎这一年"},"children":[],"text":"离开知乎这一年"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E9%80%9A%E7%94%A8%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B/","title":"通用语言模型"},"children":[],"text":"通用语言模型"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E7%A8%8B%E5%BA%8F%E5%91%98%E3%80%81%E8%BD%AF%E4%BB%B6%E5%B7%A5%E7%A8%8B%E5%B8%88%E5%92%8C%E7%A0%81%E5%86%9C/","title":"程序员、软件工程师和码农"},"children":[],"text":"程序员、软件工程师和码农"},{"tag":"br","attrs":{},"children":[]},{"tag":"a","attrs":{"href":"../GO%20SEGA%20-%20%E4%B8%96%E5%98%89%2060%20%E5%91%A8%E5%B9%B4/","title":"GO SEGA - 世嘉 60 周年"},"children":[],"text":"GO SEGA - 世嘉 60 周年"}]}]
➜  ~ plt extract --mode structured --selector "article ul" --limit 10 --offset 10
📍 https://wiki.kimleo.net/articles/%E6%96%87%E7%AB%A0%E5%88%97%E8%A1%A8/ — 文章列表 - Kimmy's Wiki (navId=2, tab=1854130533, session=pl-3c60af04)
[{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../low-code%20%E4%B8%89%E9%97%AE/","title":"low-code 三问"},"children":[],"text":"low-code 三问"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E8%A2%AB%E6%8A%9B%E5%BC%83%E7%9A%84REST/","title":"被抛弃的REST"},"children":[],"text":"被抛弃的REST"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E8%B6%85%E7%BA%A7%E9%A9%AC%E9%87%8C%E5%A5%A5/","title":"超级马里奥"},"children":[],"text":"超级马里奥"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E5%BC%BA%E5%8A%9B%E6%96%87%E9%9B%86%EF%BC%9AGitHub%E5%8C%97%E6%9E%81%E4%BB%A3%E7%A0%81%E5%BD%92%E6%A1%A3%E6%98%AF%E5%AF%B9%E4%BA%BA%E7%B1%BB%E5%8F%91%E5%B1%95%E7%9A%84%E4%B8%8D%E8%87%AA%E4%BF%A1/","title":"强力文集：GitHub北极代码归档是对人类发展的不自信"},"children":[],"text":"强力文集：GitHub北极代码归档是对人类发展的不自信"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E8%BD%AF%E4%BB%B6%E6%9E%B6%E6%9E%84%E7%9A%84%E5%9B%BE%E5%BD%A2%E5%B7%A5%E5%85%B7/","title":"软件架构的图形工具"},"children":[],"text":"软件架构的图形工具"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E8%AF%B4%E8%AF%B4%20Flutter%EF%BC%9ASkia%E3%80%81Dart%20%E5%8F%8A%E5%85%B6%E5%8E%86%E5%8F%B2/","title":"说说 Flutter：Skia、Dart 及其历史"},"children":[],"text":"说说 Flutter：Skia、Dart 及其历史"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E5%8F%88%E4%B8%80%E4%B8%AA%E4%B8%8A%E5%8F%A4%E7%A5%9E%E5%99%A8%E5%BC%80%E6%BA%90%E4%BA%86%EF%BC%8CGW-BASIC/","title":"又一个上古神器开源了，GW-BASIC"},"children":[],"text":"又一个上古神器开源了，GW-BASIC"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E8%B0%81%E5%88%B6%E9%80%A0%E4%BA%86%E7%94%B5%E5%AD%90%E6%B5%B7%E6%B4%9B%E5%9B%A0/","title":"谁制造了电子海洛因"},"children":[],"text":"谁制造了电子海洛因"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../%E6%BC%94%E8%BF%9B%E5%BC%8F%20SaaS%20%E7%B3%BB%E7%BB%9F/","title":"演进式 SaaS 系统"},"children":[],"text":"演进式 SaaS 系统"}]},{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"../SaaS%EF%BC%9A%E9%9A%94%E7%A6%BB%E7%BA%A7%E5%88%AB/","title":"SaaS：隔离级别"},"children":[],"text":"SaaS：隔离级别"}]}]
```

## plt press 没有效果

```
➜  ~ plt press "Hello world"
⚡ <textarea>  @(460,377)
➜  ~ plt type textarea "hello world"
⚡ <textarea>  @(460,377)
➜  ~ plt press "Enter"
⚡ <textarea>  @(460,377)
➜  ~ plt press "Enter"
⚡ <textarea>  @(460,377)
➜  ~ plt press "Cmd+A"
⚡ <textarea>  @(460,377)
➜  ~ plt press "ArrowDown"
⚡ <textarea>  @(460,377)
➜  ~
```

参考 https://playwright.dev/docs/api/class-keyboard 检查并验证实现。

另外，作为参考，这是在 Google 主页，我是在 Google 输入框里完成的这些动作：（一大堆 hello world 前缀是 Google Suggestion 的内容）。

```
➜  ~ plt extract
📍 https://www.google.com/ — Google (navId=1, tab=1854130533, session=pl-3c60af04)
About
Store
GmailImages
AI Mode
hello world
Hello World
2019 film
hello world anime where to watch
hello world c++
hello world baby sign
hello world code
hello world python
Hello, World! How Do Apples Grow?
Book by Jill McDonald
hello world java
hello world song

Report inappropriate predictions

Advertising
Business
How Search works
Build, create, and do more with AI tools from Google
Privacy
Terms
Settings

[viewport 1512x857]
```

## search 显示 disconnected，但是浏览器页面能够正常工作（能搜索并打开 Google 结果页）

```
➜  ~ plt search "hello world"
✖ [EXTENSION_OFFLINE] extension disconnected
➜  ~ plt search "hello world"
✖ [EXTENSION_OFFLINE] extension disconnected
➜  ~ plt search "hello world"
✖ [EXTENSION_OFFLINE] extension disconnected
```

请检验浏览器插件的通信问题、重连问题和ws server是否有完善的支持。

## 本次测试的 plt logs：

```
{"ts":"2026-09-14T04:27:11.986Z","id":"f380c3dc-ee19-46e7-a73a-8a4f10ee616c","method":"goto","params":{"url":"https://wiki.kimleo.net","waitUntil":"load"},"outcome":"error","code":"INTERNAL","durationMs":7}
{"ts":"2026-09-14T04:27:19.537Z","id":"f753d5ad-bf00-4c12-85f2-4c33f268e2a7","method":"goto","params":{"url":"https://wiki.kimleo.net","waitUntil":"load"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":418}
{"ts":"2026-09-14T04:27:53.754Z","id":"01541464-c5d6-4b19-9c81-b24fbe3cebee","method":"extract","params":{"mode":"text","article":true},"outcome":"error","code":"INVALID_PARAMS","durationMs":1}
{"ts":"2026-09-14T04:28:29.750Z","id":"12bed473-e0c6-473b-9bf7-31b4403c8a12","method":"extract","params":{"mode":"text"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":5}
{"ts":"2026-09-14T04:28:44.329Z","id":"d3c768a7-7b8e-4e6a-9791-d76a9193bc85","method":"click-text","params":{"text":"关于我"},"outcome":"error","code":"TARGET_AMBIGUOUS","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":5616}
{"ts":"2026-09-14T04:29:06.406Z","id":"37f0815b-12d3-4d63-8519-0a099ddb1e60","method":"click-text","params":{"text":"文章列表"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":44}
{"ts":"2026-09-14T04:29:25.050Z","id":"1015c853-4937-4534-9598-745f079403e1","method":"extract","params":{"mode":"structured"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":15}
{"ts":"2026-09-14T04:29:55.591Z","id":"b2df3e56-e920-4e78-a034-4e852cf82596","method":"extract","params":{"mode":"structured","selector":"article"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":9}
{"ts":"2026-09-14T04:30:12.560Z","id":"644c10c3-b253-4be0-bc45-4a2d583247c9","method":"extract","params":{"mode":"structured","selector":"article","limit":10},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":20}
{"ts":"2026-09-14T04:31:10.473Z","id":"710d675a-0918-4478-a632-d51d34352d05","method":"extract","params":{"mode":"structured","selector":"article ul","limit":10},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":6}
{"ts":"2026-09-14T04:31:39.788Z","id":"e8c89e20-43a5-4987-9e99-4f5495e82bdb","method":"extract","params":{"mode":"structured","selector":"article ul","offset":10,"limit":10},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":2081}
{"ts":"2026-09-14T04:37:16.185Z","id":"6fbd90c7-6937-4ed5-9efd-609193822a12","method":"goto","params":{"url":"https://google.com","waitUntil":"load"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":2457}
{"ts":"2026-09-14T04:37:57.585Z","id":"d0dcd6fa-9d4c-4e23-b0bc-9f60ef7b3ef0","method":"type","params":{"selector":"input","text":"Hello world"},"outcome":"error","code":"INTERNAL","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":19}
{"ts":"2026-09-14T04:38:11.037Z","id":"bfd79f01-c423-4cc2-afc0-e0a57d09b31e","method":"press","params":{"key":"Hello world"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":9}
{"ts":"2026-09-14T04:38:32.059Z","id":"fe58b83f-46e2-43fd-90ee-d0883678d79e","method":"type","params":{"selector":"textarea","text":"hello world"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":25}
{"ts":"2026-09-14T04:40:02.295Z","id":"9ef5d5e8-9b5a-4aab-ad18-994abff76b7d","method":"press","params":{"key":"Enter"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":12}
{"ts":"2026-09-14T04:40:10.707Z","id":"501e8183-15db-4729-9625-67d7fa8caa0e","method":"press","params":{"key":"Enter"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":10}
{"ts":"2026-09-14T04:40:37.871Z","id":"293b592a-966a-4389-8d8d-99435c83cca3","method":"press","params":{"key":"Cmd+A"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":34}
{"ts":"2026-09-14T04:40:56.278Z","id":"fe3a6511-1277-4dfd-b80a-7f0527d85597","method":"press","params":{"key":"ArrowDown"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":5}
{"ts":"2026-09-14T04:44:07.942Z","id":"8a78ed73-f617-4d96-9fee-d023b290b306","method":"press","params":{"key":"Backspace"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":13}
{"ts":"2026-09-14T04:44:17.500Z","id":"eeaaedc1-822d-417a-b4d4-46f11fd55058","method":"press","params":{"key":"ArrowLeft"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":365}
{"ts":"2026-09-14T04:45:02.748Z","id":"e73c820c-79c4-4e25-8693-9ccb223fa1a3","method":"press","params":{"key":"Control+A"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":28}
{"ts":"2026-09-14T04:46:42.588Z","id":"fb166bbd-41e7-4a01-9d12-cd6ce20b24f2","method":"extract","params":{"mode":"text"},"outcome":"ok","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":3}
{"ts":"2026-09-14T04:50:29.392Z","id":"f1c0c587-2bde-43c1-a724-1c343bd79067","method":"search","params":{"query":"hello world","page":1},"outcome":"error","code":"EXTENSION_OFFLINE","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":268}
{"ts":"2026-09-14T04:50:48.455Z","id":"ecedc117-6534-4539-bf5f-7fc8f4578b56","method":"search","params":{"query":"hello world","page":1},"outcome":"error","code":"EXTENSION_OFFLINE","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":555}
{"ts":"2026-09-14T04:50:53.763Z","id":"c90eb1cd-9e1e-4b33-8578-5f40024ab5c6","method":"search","params":{"query":"hello world","page":1},"outcome":"error","code":"EXTENSION_OFFLINE","sessionId":"pl-3c60af04","tabId":1854130533,"durationMs":297}
{"ts":"2026-09-14T04:51:58.583Z","id":"01beaab1-941f-42d0-bf77-180d49baa30a","method":"fetch","params":{"url":"https://wiki.kimleo.net/","method":"GET","headers":"[redacted]","returnType":"text"},"outcome":"error","code":"EXTENSION_OFFLINE","durationMs":1}
```

## 修复记录（2026-09-14）

本地 mock（`tests/e2e/support.ts` 的 `/search`、`/results`、`/list`、`/article`）复现全部问题；E2E 见 `tests/e2e/parkinglot.e2e.spec.ts`。

### 1. `extract --article` 报 `INVALID_PARAMS`（已修复）

- **根因**：CLI 的 `--mode` 默认值 `'text'` 被无条件写入 params，与 `article:true` 在 schema 层互斥（`.refine`）冲突；schema 是对的，错在 CLI 注入默认值。
- **修复**：`plt extract` 的 `--mode` 去掉默认值，仅在显式传入时才发送（extension 侧仍默认 text）。
- **测试**：E2E `extract --article 不再误报 INVALID_PARAMS`（spawn 真实 CLI）。

### 2. `limit/offset` 无 total / 分页信息（已增强）

- **根因**：`extract` 结果只返回切片后的 `nodes`/`texts`，没有总数列数，Agent 无法判断是否还有下一页。
- **修复**：`ExtractResult` 的 structured 与 text-selector 分支新增 `total`（visibleOnly 过滤后、分页前的第一层元素总数），并在传入时回显 `offset`/`limit`；CLI 打印 `[showing X of TOTAL, offset=…, limit=…]`。
- **测试**：E2E `extract structured 分页`；单测 `snapshot.test.ts`。

### 3. `plt press` 无效（已修复）

- **根因（两层）**：
  1. 合成的 `KeyboardEvent` 没有 `keyCode`/`which`/`charCode`，依赖旧属性的站点（含 Google 建议）收不到；且 isolated world 里 `Object.defineProperty(event,'keyCode')` **无法跨 world 传给页面**（实测页面读到 `keyCode:0`）。
  2. 不可信事件不触发原生默认动作（Enter 提交表单、⌘A 全选、Backspace 删除等）。
- **修复**：
  - 新增 **MAIN world** 内容脚本 `content-main.ts`（manifest `world:"MAIN"`，`document_start`），在主世界补全 `KeyboardEvent.prototype` 的 `keyCode`/`which`/`charCode` getter（可信事件取原生值，合成事件按 `key` 推导），不受页面 CSP 限制。
  - content 侧 `press` 补全 `key/code/keyCode/which/charCode` 并模拟默认动作：单字符插入、Backspace/Delete、Ctrl/Cmd+A 全选、Enter 提交表单、输入框内箭头/Home/End 移动光标；未知多字符键（如误写 `press "Hello world"`）明确报 `INVALID_PARAMS`。
- **测试**：E2E `press：ArrowDown(keyCode) 驱动页面 JS + Enter 触发表单提交`、`press Enter：普通表单提交`；单测 `keyDef`/`press default actions`。
- **已知限制**：仍非原生可信事件；个别强依赖原生行为（如 IME、复杂富文本编辑器）可能与真人按键有差异。

### 4. `search`/`fetch` 偶发 `EXTENSION_OFFLINE`（已修复）

- **调查结论**：错误信息 `extension disconnected` 来自 server 的 `ws/server.ts` `resetConnection()`——即 WS 断开时正在途中的命令被拒。日志显示 04:50:29→04:51:58 约 90s 未恢复，而页面本身正常 → 指向 **MV3 service worker 空闲被回收**：`chrome.alarms`（30s 周期）本可唤醒重连，但浏览器后台/省电下 alarms 可能被延迟，形成较长离线窗口；协议级 WS ping/pong 由网络栈处理、不计入 SW 活动，无法保活。
- **修复**：扩展侧新增**应用层心跳**：WS 在线时每 20s 发送一条 `{type:'heartbeat'}`。Chrome 116+ 中 WebSocket 收发消息会重置 SW 空闲计时器，从而避免回收；alarms 仅作兜底（并修正为 `ws===null` 时才重连，避免 CONNECTING 期重复建连）。
- **server 侧评估**：单连接替换、握手鉴权、断线时挂起命令归一化为 `EXTENSION_OFFLINE` 均正确；`latestTabId` 在 server 内存中跨重连保留。当前策略是「离线即失败、由 Agent 重试」，未做服务端有界等待重连（可后续增强）。
- **测试**：E2E `连接保活：空闲期间始终保持在线且真实命令可用`（70s 内持续轮询 `/api/status` 不应出现 offline，再用无重试的真实命令验证）、`重连：强制终止 SW 后自动重连`（测试用 CDP `ServiceWorker.stopAllWorkers` 后等 alarms 重连；生产代码不使用 CDP）。
- **说明**：连接问题依赖真实浏览器 SW 生命周期，headless Chromium 下未必触发回收，E2E 作为回归护栏而非完全等价复现。

### 5. `extract --article` 返回原始 HTML 而非 Markdown（已修复）

- **现象**：`plt extract --article` 输出 `<div> <h2>…</h2> … </div>` 原始 HTML，而 `defuddle.md/<url>` 输出的是干净 Markdown + YAML frontmatter。
- **根因**：扩展导入的是核心包 `defuddle`，其 **不包含 markdown 转换器**（`markdown: true` 被静默忽略，`content` 保持 HTML；`contentMarkdown` 为空）。经隔离验证：核心包 `markdown:true` 仍返回 HTML，`defuddle/full` 才带 turndown 转换。
- **修复**：`snapshot.ts` 改用 `defuddle/full`（`markdown: true` 生效），`article` 结果新增 `description`/`domain`/`language`/`url` 字段，CLI 以 YAML frontmatter 打印。
- **代价**：`defuddle/full` 含 turndown + 数学转换库；已开启 esbuild `minify`，`content.js` ≈755KB（未压缩时约 1.1MB），`background.js` ≈8KB。
- **测试**：E2E `extract --article 不再误报 INVALID_PARAMS` 现断言输出为 Markdown（`**bold**`、`[link](…)`、无 `<p>`）且含 `title:`/`url:` frontmatter。

### 6. server Ctrl+C 不立即退出 + `MaxListenersExceededWarning`（已修复）

- **现象**：扩展连上后 Ctrl+C 不能立即停止，且出现 `11 close listeners added to [Server]`。
- **根因**：`httpServer.close()` 会等待长连接（WebSocket），而 `ExtensionHub.close()` 只调用 `wss.close()`、未终止活跃连接 → `close()` 回调永不触发 → 进程不退出；用户反复 Ctrl+C 时每次 `server.close()` 都会给自己加一个 `close` 监听，累积超过 10 个触发 warning。
- **修复**：`ExtensionHub.close()` 主动 `close(1001, 'server shutting down')` 并延迟 `terminate()` 兜底、加超时；`startServer.close()` 调用 `httpServer.closeAllConnections()`；`plt serve` 的 shutdown 加**重入保护 + 2s 兜底超时**后 `process.exit(0)`。
- **验证**：脚本连上真实 WS 后发 SIGINT → **exit code 0、59ms、客户端收到 close code 1001**，无 MaxListeners 警告；单测 `ws/server.test.ts`。

### 7. 扩展连接失败体验不平滑（已修复）

- **现象**：reload 扩展且 server 不在时，控制台直接报 `WebSocket connection … ERR_CONNECTION_REFUSED`，且无状态提示。
- **说明**：该报错是**浏览器网络栈**输出，扩展代码无法抑制；能做的是不把它当异常、并给出明确状态。
- **修复（状态 badge + popup 引导）**：
  - 新增 `status.ts` 状态机 `unconfigured | connecting | connected | auth_failed | disconnected`；
  - action badge：绿=connected、红=disconnected、橙=unconfigured/auth_failed（connecting 保持上一个）；
  - 状态持久化到 `chrome.storage.session`，SW 重启后 `restoreState()` 重设 badge；
  - **token 被拒（close 4401/4400）→ 停止自动重连**，避免骚扰 server；`disconnected` 才退避重连；
  - popup 按状态给引导（未配置 / token 错 / server 不可达）+ **Retry** 按钮。
- **验证**：E2E 4 例（绿/橙 token 错/红 server 停止/橙未配置）；单测 `status.test.ts`。

### 8. `type` 泛化 selector 报 `INTERNAL`（已修复）

- **现象**：日志中 `{"method":"type","params":{"selector":"input"},...,"code":"INTERNAL"}`（04:37:57，Google）。
- **修复**：`type`/`fill` 统一走 `resolveInput()`（自身可编辑 > label[for] > 最近 label/fieldset 唯一 > 后代唯一，否则 `TARGET_*`），不再对任意命中元素强转 input；泛化 selector（`input`、容器如 `form`）均可解析。
- **测试**：E2E `type：泛化 selector（input / 容器）也能解析并输入`。

### 9. `plt screenshot` 不带 `--path` 时只报体积、无目标（已修复）

- **现象**：`plt screenshot` 输出 `📸 462.2 KB base64`，既没写文件也没给目标路径。
- **修复**：未指定 `--path` 时默认落盘到 cwd 下的 `screenshot-<时间戳>.<png|jpeg>`（由 `--format` 决定后缀），并打印**绝对路径**；`--json` 仍返回原始 envelope（base64）供程序消费。
- **测试**：E2E `screenshot CLI：未指定 --path 时默认落盘并打印路径`（临时 cwd，校验文件存在且 >1KB）。

### 10. `plt ping` 显示 connected，紧接着命令报 `EXTENSION_OFFLINE extension disconnected`（已修复）

- **现象**：`plt ping`（server-local）显示 `extension connected ✅`，下一条 `plt extract` 立刻报 `extension disconnected`（该文案来自 server `resetConnection()` = WS 在命令在途时被关闭）。
- **根因**：扩展的 `connect()` **无并发/重复建连保护**，而 `alarms`、应用层心跳、`scheduleReconnect`、`storage.onChanged`、`onStartup` 都可能在 `ws===null` 时同时调用它（`connect()` 在 `await getConfig()` 前后各有一个窗口）。更糟的是 `ws.onclose`/`onerror` 直接操作全局 `ws`：旧 socket 的 close 会把已被新 socket 覆盖的 `ws` 置空。结果 server 端"新连接替换旧连接"（`close(4001)` + `resetConnection()`）会**丢弃在途命令**并引发连接抖动。`ping` 走 server 本地、不碰 WS，所以先显示 connected，下一条真实命令才暴露。
- **修复**：
  - `connect()` 增加 `connecting` 锁 + 已 CONNECTING/OPEN 则直接返回；
  - 每个 socket 的 handler 都校验 `ws === socket`，旧连接事件不再影响当前连接；
  - 新增 `forceReconnect()`：配置变更/手动 Retry 时**主动断开旧连接**再用新配置重连（否则加锁后会"连着旧配置不重连"）。
- **验证**：E2E `连接稳定：短时间内多次配置变更后仍恢复并可用`；并用**临时回退对照**确认：去掉锁与 socket 校验后该用例失败，恢复后通过（即精确复现该 bug）。
