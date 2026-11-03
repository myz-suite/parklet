# TODO

> 已完成：`docs/v5-incremental-plan.md`（时间线抓取可靠性：scroll 契约 / extract --fields / collect --repeat / stdout 分离 / tab / click-text / wait / links&forms 并入 extract / page-info / run 变量 / screenshot 聚焦；旧能力队列见附录 B）。

## Done

- [x] V2 plan
- [x] Code Execution
- [x] Search result include summary
- [x] Text Selection
- [x] `links` / `form` show all actionable items
  - Links show: Link text, target URL
  - Form element show: Field name, type (button / input / select / textarea / checkbox / radio / submit / reset), value? and (possible) labels
    - Forms grouped by `form` action/target

## TODO — 能力与覆盖范围

- [ ] **iframe / shadow DOM 支持**：当前 content script 未启用 `all_frames`、定位器仅用 `document.querySelector`，跨 frame 与 Shadow DOM 页面不可操作。
- [ ] **浏览器能力补全**：文件上传、dialog（alert/confirm）处理、下载处理、网络拦截均未实现；`wait --condition networkidle` 目前是近似实现。
- [ ] **输入真实性**：合成的 keyboard/input 事件对 IME、复杂富文本编辑器与真人按键存在差异（已在 protocol/skill 文档标注为已知限制）。
- [ ] **并发与编排**：单扩展实例 / 单 WS 连接，尚无多 Agent 或并发编排设计（session 概念已移除，统一为单一 current tab）。

## Risks — 反侦测指纹（已知风险，后续专门方案处理）

当前实现**能避开 CDP 类检测**（无远程调试、无 `navigator.webdriver`），但引入了新的可检测指纹：

- MAIN world 改写 `KeyboardEvent.prototype` 的 `keyCode`/`which`/`charCode` getter —— 页面可通过原生原型对比检测。
- 合成键盘/输入事件 `isTrusted=false`；`fill` 直接赋值 + 派发 `input`/`change`。
- `click` 仅触发 `click`，缺少 `pointermove`/`mousedown`/`mouseup` 序列与坐标。
- 无人类化时序 / 鼠标轨迹。

结论：对只看 CDP 特征的站点有效，对行为型/指纹型风控仅部分有效；不作为“稳定绕过侦测”的保证。

## Future plan — Security (auth / network)

暂不处理，作为独立计划后续设计：

- HTTP API 无鉴权且不校验 `Origin`/`Host`：本机进程可直接驱动浏览器；用户访问的网站可能借 localhost 盲发命令（CSRF 驱动）。计划加 `Authorization: Bearer <token>` 与来源校验，或改用 Unix socket。
- `PARKLET_BIND` 可改为非回环且无守卫：存在把无鉴权 API 暴露到网络的风险。
- token 直接打印到 stdout，可能进入终端日志 / shell 历史。
- eval 默认禁用，但一旦开启，配合无鉴权 API 存在数据外发风险。
- 待验证：Chrome Private Network Access 是否足以拦截来自公网页面对 `127.0.0.1` 的请求。
