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
