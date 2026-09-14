# ParkingLot Protocol Reference (v0.1.0-draft)

> Authoritative command reference for the `parkinglot` skill, describing the wire protocol between the agent-facing CLI/HTTP and the browser extension.
> Worked examples: [`example.md`](./example.md).

The protocol follows the CDP/Playwright mental model: JSON-RPC-style envelopes (`id/method/params` → `id/result|error`) with flat kebab-case command names (one-to-one with CLI subcommands).

## Transport

| Link               | Transport                                            | Notes                             |
| ------------------ | ---------------------------------------------------- | --------------------------------- |
| extension ↔ server | WebSocket (`127.0.0.1`, token pairing)               | Text frames, JSON encoding        |
| Agent ↔ server     | CLI subprocess (default) or HTTP `POST /api/command` | Same envelope, no transport delta |

Messages are UTF-8 JSON; message size is capped at 10 MB (`MESSAGE_TOO_LARGE` beyond that); commands time out after 30 s by default (`TIMEOUT`).

## Message Envelope

### Request (command)

```json
{ "id": "cli-1", "method": "goto", "params": { "url": "https://example.com" } }
```

### Response (success)

The common `result` fields carry addressing and continuity information; `data` holds command-specific results:

```json
{
  "id": "cli-1",
  "result": {
    "tabId": 7,
    "context": { "url": "https://example.com", "title": "Example", "navId": 2, "tabId": 7 },
    "data": {},
    "unreadCount": 0
  }
}
```

> `unreadCount` (optional) is attached by the server's **HTTP** `/api/command` response only, counting cached `tab.created`/`tab.removed` events since the last `plt events` / `GET /api/events`. The CLI prints `N new events, run \`plt events\`` when non-zero. The WS responses to the extension do not carry it.

### Response (failure)

```json
{ "id": "cli-1", "error": { "code": "TIMEOUT", "message": "command timed out after 30000ms" } }
```

### Event (extension → server)

```json
{ "event": "page.navigated", "params": { "tabId": 7, "url": "https://example.com" } }
```

## Addressing & Continuity (tab / navId)

Optional addressing fields in command `params`, in priority order:

1. `params.tabId` — explicit physical tab (temporary; not remembered)
2. the server's **current tab** (set by the last successful command)
3. Fallback: the most recently active tab; `EXTENSION_NO_TAB` when none is available

**Continuity self-verification**: the `context` snapshot on every response is the single source of truth for an agent deciding whether the page changed —

- `url` / `title` changed → the page navigated
- `navId` incremented → a navigation occurred (`goto`/`back`/`forward`/`reload`)
- `tabId` changed → the target moved

CLI-side mental model:

```
plt goto <url>          # sets the current tab; response carries tabId/context
plt click "Submit"      # acts on the current tab by default
plt <cmd> --tab 123     # explicitly target another tab for this command
```

## Command Set

Write-access markers are advisory (audit/logging): `always` = write operation; `never` = read-only; `conditional` = depends on parameters.

### Navigation

| Command   | Params                                                       | Returns data               | Write  |
| --------- | ------------------------------------------------------------ | -------------------------- | ------ |
| `goto`    | `url` (http/https), `waitUntil?` (`load`/`domcontentloaded`) | — (context is the product) | always |
| `back`    | —                                                            | —                          | always |
| `forward` | —                                                            | —                          | always |
| `reload`  | —                                                            | —                          | always |

### Interaction

| Command      | Params                                                                                                          | Returns data               | Write  |
| ------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------- | ------ |
| `click`      | `selector` (CSS)                                                                                                | `{ element: ElementInfo }` | always |
| `click-text` | `text` (visible text, fuzzy match + dedup)                                                                      | `{ element }`              | always |
| `fill`       | `selector`, `value` (whole-value replace; selector may point at a label/container and is resolved to its input) | `{ element }`              | always |
| `type`       | `selector`, `text` (per keystroke; selector resolved to its input)                                              | `{ element }`              | always |
| `press`      | `selector?`, `key` (Playwright-style combo, e.g. `Control+c`)                                                   | `{ element }`              | always |
| `hover`      | `selector`                                                                                                      | `{ element }`              | always |
| `select`     | `selector`, `value?`/`label?` (at least one)                                                                    | `{ element }`              | always |
| `selection`  | `selector?` / `text?` (at least one; CSS or visible text)                                                       | `{ text }`                 | always |

> `press` accepts a Playwright-style key or combo (`Enter`, `ArrowDown`, `Control+c`, `Meta+s`, `Shift+Tab`, `Backspace`, …). It dispatches the full `keydown`/`keypress`/`keyup` sequence with `key`/`code`/`keyCode`/`which`/`charCode`, and emulates common default actions (printable insert, Backspace/Delete, Ctrl/Cmd+A select-all, Enter form submit, input caret moves). Legacy key codes are backfilled so pages that read `keyCode` (e.g. Google suggestions) react. Single characters and named keys are supported; an unknown multi-character key returns `INVALID_PARAMS`. These are synthetic (untrusted) events — behavior can differ from real keystrokes for IME / rich editors.

### Scroll / View

| Command      | Params                                                                   | Returns data               | Write  |
| ------------ | ------------------------------------------------------------------------ | -------------------------- | ------ |
| `scroll`     | `direction?` (up/down/top/bottom), `amount?`, `selector?` (at least one) | `{ viewport }`             | always |
| `scroll-to`  | `selector`                                                               | `{ element }`              | always |
| `screenshot` | `format?` (png/jpeg), `fullPage?`, `selector?` (element crop), `path?`   | `{ data?: base64, path? }` | never  |

> `scroll` without `selector` scrolls the page. **With `selector` it scrolls inside that element** (its `overflow` content, e.g. a lazy-loading list) — it does not move the page. Use `scroll-to <selector>` to bring an element into the page viewport.

> Element screenshots (`selector`) require the target tab to be the active tab of its window; otherwise `TAB_NOT_ACTIVE`. The element is scrolled (instantly) into view if needed and the visible part is cropped (`devicePixelRatio`/zoom aware). If the tab is not active, activate it first (`plt tab <id>`) or omit `selector`.

### Extraction

| Command         | Params                                           | Returns data                                              | Write |
| --------------- | ------------------------------------------------ | --------------------------------------------------------- | ----- |
| `extract`       | see below (text / structured / html / article)   | discriminated union by result `mode`                      | never |
| `get-page-info` | —                                                | `{ url, title, viewport, scrollY }`                       | never |
| `dom-query`     | `selector?` / `text?` (at least one), `limit?`   | `{ matches: [{ tag, class?, id?, text?, box? }], total }` | never |
| `links`         | `selector?`, `offset?`, `limit?`, `visibleOnly?` | `{ links, total, offset?, limit?, truncated? }`           | never |
| `forms`         | `selector?`, `offset?`, `limit?`, `visibleOnly?` | `{ forms, total, offset?, limit?, truncated? }`           | never |

`links` enumerates visible anchors and **groups them by absolute `href`**; each `LinkInfo` carries `texts[]` (DOM order, deduped) and `count` (occurrences). `javascript:` hrefs, empty hrefs and pure `#` anchors are dropped. Pagination slices the **href groups**; `total` is the number of groups.

`forms` enumerates visible `input`/`select`/`textarea`/`button` controls and **groups them by form `action`/`method`/`target`** (controls not owned by a `<form>` form an `action`-less group). Fields include `tag`/`type`/`name`/`value`/`labels` (`label[for]` > wrapping label > `aria-label` > `placeholder`), plus `checked`/`selected`/`disabled`/`required`/`id`. `input[type=password]` values are masked as `********`. Pagination slices the **fields** (flat across groups); `total` is the number of fields, and each group carries only the fields falling inside `[offset, offset+limit)`.

Both default to `visibleOnly: true` (pass `false` to include invisible items) and share a collection cap (`truncated: true` when hit) applied **before** paging.

`extract` params (all optional):

- `mode`: `text` (default), `structured`, or `html`.
- `article`: `true` → defuddle article extraction. Mutually exclusive with `mode`; `selector` is then used as `contentSelector`.
- `selector`: CSS selector. Without it, text = whole page and structured = `body`.
- `offset` / `limit`: applied to the **first-level list** — the matched roots when the selector matches several elements, or a single root's children when it matches one. `limit` is always an element count.
- `depth`: recursion depth below each root (exclusive of the root); default 3, no fixed cap.
- `visibleOnly`: drop invisible elements from the first-level list (subtrees keep their structure).
- `maxChars`: per-segment character truncation for text mode (omitted = no truncation).
- `exclude`: CSS selector; matching elements (and their subtrees) are dropped before extracting (text/structured/html), e.g. to remove copy buttons or rate-limit notices.

Result is discriminated by `mode`:

```ts
type ExtractResult =
  | { mode: 'text'; snapshot: PageSnapshot } // no selector, whole page
  | { mode: 'text'; texts: string[]; total: number; offset?; limit? } // with selector, per first-level element
  | { mode: 'structured'; nodes: DomNode[]; total: number; offset?; limit?; truncated?: boolean } // DOM tree (maxNodes=500 budget, BFS truncation)
  | { mode: 'html'; items: string[]; total: number; offset?; limit? } // outerHTML per matched element (no truncation)
  | {
      mode: 'article';
      content: string;
      title?;
      author?;
      site?;
      description?;
      domain?;
      language?;
      url?;
      wordCount?;
    };
```

For selector-based results, `total` is the number of first-level elements (after `visibleOnly`, before paging), so an agent can iterate with `offset`/`limit` until `offset + nodes.length >= total`. `offset`/`limit` are echoed when provided.

`mode: 'html'` returns the `outerHTML` of each **matched** element (the first-level list is the matched elements themselves, not their children), with no text truncation. It is the lossless page-element capture — e.g. `--selector ".markdown"` yields the rendered HTML so callers can tell `thinking` blocks from `content` by class. Structured mode's per-node direct text is no longer character-truncated (the `MAX_STRUCTURED_NODES=500` tree budget still applies).

`article` returns `content` as **Markdown**; an optional `selector` restricts extraction to that element. Metadata is returned as separate fields and the CLI prints it as YAML frontmatter.

### In-page Network (executed in the real page context, with login state)

| Command  | Params                                                                                | Returns data                                                                   | Write       |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------- |
| `fetch`  | `url`, `method?`, `headers?`, `body?`, `returnType?`                                  | `{ status, statusText?, headers, body }`                                       | conditional |
| `search` | `query`, `engine?` (google\|duckduckgo; default google), `page?` (1-based, default 1) | `{ results: [{ title, url, snippet? }], pagination: { query, engine, page } }` | never       |

> Pagination note: `page` offsets results per engine — **google supports it** (10/page, verified on real Chrome). The DuckDuckGo **html endpoint ignores the offset**, so `duckduckgo` with `page > 1` re-returns page 1; prefer the default `google` engine when paging.
>
> `snippet` is parsed on a best-effort basis. DuckDuckGo's html layout is stable; Google's DOM changes often, so its snippet may be missing on some layouts.

### Tabs

| Command        | Params   | Returns data          | Write  |
| -------------- | -------- | --------------------- | ------ |
| `list-tabs`    | —        | `{ tabs: TabInfo[] }` | never  |
| `create-tab`   | `url`    | `{ tab }`             | always |
| `close-tab`    | `tabId?` | —                     | always |
| `activate-tab` | `tabId`  | `{ tab }`             | always |

### Waiting

| Command | Params                                                                             | Returns data | Write |
| ------- | ---------------------------------------------------------------------------------- | ------------ | ----- |
| `wait`  | `ms?`, `selector?` (until visible), `condition?` (networkidle/load) (at least one) | —            | never |

### Server state

| Command      | Params | Returns data                                    | Write |
| ------------ | ------ | ----------------------------------------------- | ----- |
| `ping`       | —      | `{ pong, protocolVersion, extensionConnected }` | never |
| `get-status` | —      | `{ extensionConnected, currentTabId?, config }` | never |

### Advanced (disabled by default)

| Command | Params   | Returns data          | Write  |
| ------- | -------- | --------------------- | ------ |
| `eval`  | `script` | `{ value?: unknown }` | always |

`eval` runs a **complete script** (multiple statements, must contain `return`) in the page's **MAIN world** (page context, so it can read page globals like `window.React`) and returns its JSON-serialized result. `undefined` omits `value`; a result that cannot round-trip through JSON raises `NOT_SERIALIZABLE`. Isolated-world `eval` is impossible under the MV3 extension CSP, and **MAIN-world eval is still subject to the page's CSP** — pages with a strict `script-src` will fail with an injection error. It is disabled by default (`PARKINGLOT_DISABLED_COMMANDS`); enable it with `PARKINGLOT_ENABLE_EVAL=1` (an explicit `eval` entry in the disable list still wins), otherwise the server returns `EVAL_DISABLED`.

## Events (v1 minimal set)

| Event                                            | Direction          | Trigger                   | Purpose                                           |
| ------------------------------------------------ | ------------------ | ------------------------- | ------------------------------------------------- |
| `extension.connected` / `extension.disconnected` | server → extension | extension WS state change | logs, status                                      |
| `extension.tab-activated`                        | extension → server | tab activation            | server tracks "most recent active tab" fallback   |
| `page.navigated`                                 | extension → server | top-frame navigation done | audit                                             |
| `tab.created`                                    | extension → server | a tab is created          | server event cache / unread count                 |
| `tab.removed`                                    | extension → server | a tab is closed           | clear the current tab if it matches + event cache |

`tab.created` / `tab.removed` are cached in memory (last 100) and surfaced by `plt events` / `GET /api/events`; command responses carry the unread count. When the current tab is removed, the server clears it and the next command falls back to the most recently active tab.

`Network.*` is an extension point: page-level network events are not implemented.

## Error Codes

| code                                                                          | meaning                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------- |
| `INVALID_REQUEST` / `INVALID_PARAMS` / `UNKNOWN_METHOD` / `MESSAGE_TOO_LARGE` | envelope/params validation failed           |
| `EXTENSION_OFFLINE` / `EXTENSION_NO_TAB`                                      | extension not connected / no operable tab   |
| `TAB_CLOSED`                                                                  | the targeted / current tab no longer exists |
| `TIMEOUT`                                                                     | command timed out (default 30 s)            |
| `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`                                       | locator matched nothing / several elements  |
| `TAB_NOT_ACTIVE`                                                              | element screenshot on a non-active tab      |
| `URL_INVALID` / `HOST_NOT_ALLOWED`                                            | invalid URL / host not in allowlist         |
| `EVAL_DISABLED`                                                               | eval not enabled                            |
| `NOT_SERIALIZABLE`                                                            | eval result cannot round-trip through JSON  |
| `INTERNAL`                                                                    | catch-all error                             |

## Validation (Postel's Law)

- **Be conservative in what you send**: params are validated per command against an exact schema.
- **Be liberal in what you accept**: unknown fields are stripped; optional fields default.
- Both ends (server and extension) validate with the same schemas.

## Common Types

```ts
interface ContextSnapshot {
  url: string;
  title: string;
  navId: number;
  tabId: number;
}
interface PageSnapshot {
  context: ContextSnapshot;
  visibleText: string;
  viewport: Viewport;
  scrollY: number;
}
interface ElementInfo {
  tag: string;
  text?: string;
  attrs: Record<string, string>;
  box?: { x; y; width; height };
}
interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}
interface Viewport {
  width: number;
  height: number;
}
interface DomNode {
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children: DomNode[];
}
interface LinkInfo {
  href: string; // absolute
  texts: string[];
  count: number;
}
interface FormFieldInfo {
  tag: string; // input | select | textarea | button
  type: string;
  name?: string;
  value?: string; // password masked as '********'; file omitted
  labels: string[];
  checked?: boolean;
  selected?: string[];
  disabled?: boolean;
  required?: boolean;
  id?: string;
}
interface FormInfo {
  action?: string;
  method?: string; // uppercased, defaults to GET
  target?: string;
  fields: FormFieldInfo[];
}
```
