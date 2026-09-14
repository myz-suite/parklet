# ParkingLot Protocol Reference (v0.1.0)

> Authoritative command reference for the `parkinglot` skill and both ends of the implementation.
> Location: `skills/parkinglot/references/protocol.md` (`docs/protocol.md` is a symlink to this file). A Chinese version is available at `protocol.zh.md`.
> Implementation: `packages/protocol` (`@parkinglot/protocol`; paths in this document are relative to the repository root).

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

The three common `result` fields carry addressing and continuity information; `data` holds command-specific results:

```json
{
  "id": "cli-1",
  "result": {
    "sessionId": "pl-01HK…",
    "tabId": 7,
    "context": { "url": "https://example.com", "title": "Example", "navId": 2, "tabId": 7 },
    "data": {}
  }
}
```

### Response (failure)

```json
{ "id": "cli-1", "error": { "code": "TIMEOUT", "message": "command timed out after 30000ms" } }
```

### Event (extension → server)

```json
{ "event": "page.navigated", "params": { "tabId": 7, "url": "https://example.com" } }
```

## Addressing & Continuity (session / tab / navId)

Optional addressing fields in command `params`, in priority order:

1. `params.sessionId` — explicit logical session
2. `params.tabId` — explicit physical tab
3. (default) the server's default session (persisted in the state file)
4. Fallback: the most recently active tab; `EXTENSION_NO_TAB` when none is available

**Continuity self-verification**: the `context` snapshot on every response is the single source of truth for an agent deciding whether the page changed —

- `url` / `title` changed → the page navigated
- `navId` incremented → a navigation occurred (`goto`/`back`/`forward`/`reload`)
- `tabId` changed → focus moved away

CLI-side session mental model:

```
plt goto <url>          # no session → auto-created and remembered; response carries sessionId/tabId/context
plt click "Submit"      # acts on the last session by default
plt session list|use|new|close
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

> `press` accepts a Playwright-style key or combo (`Enter`, `ArrowDown`, `Control+c`, `Meta+s`, `Shift+Tab`, `Backspace`, …). It dispatches the full `keydown`/`keypress`/`keyup` sequence with `key`/`code`/`keyCode`/`which`/`charCode`, and emulates common default actions (printable insert, Backspace/Delete, Ctrl/Cmd+A select-all, Enter form submit, input caret moves). A MAIN-world content script backfills legacy key codes so pages that read `keyCode` (e.g. Google suggestions) react. Single characters and named keys are supported; an unknown multi-character key returns `INVALID_PARAMS`. These are synthetic (untrusted) events — behavior can differ from real keystrokes for IME / rich editors.

### Scroll / View

| Command      | Params                                                                   | Returns data               | Write  |
| ------------ | ------------------------------------------------------------------------ | -------------------------- | ------ |
| `scroll`     | `direction?` (up/down/top/bottom), `amount?`, `selector?` (at least one) | `{ viewport }`             | always |
| `screenshot` | `format?` (png/jpeg), `fullPage?`, `selector?` (element crop), `path?`   | `{ data?: base64, path? }` | never  |

> Element screenshots (`selector`) require the target tab to be the active tab of its window; otherwise `TAB_NOT_ACTIVE`. The element is scrolled (instantly) into view if needed and the visible part is cropped (`devicePixelRatio`/zoom aware). If the tab is not active, activate it first (`plt tab <id>`) or omit `selector`.

### Extraction

| Command         | Params                                  | Returns data                         | Write |
| --------------- | --------------------------------------- | ------------------------------------ | ----- |
| `extract`       | see below (text / structured / article) | discriminated union by result `mode` | never |
| `get-page-info` | —                                       | `{ url, title, viewport, scrollY }`  | never |

`extract` params (all optional):

- `mode`: `text` (default) or `structured`.
- `article`: `true` → defuddle article extraction. Mutually exclusive with `mode`; `selector` is then used as `contentSelector`.
- `selector`: CSS selector. Without it, text = whole page and structured = `body`.
- `offset` / `limit`: applied to the **first-level list** — the matched roots when the selector matches several elements, or a single root's children when it matches one. `limit` is always an element count.
- `depth`: recursion depth below each root (exclusive of the root); default 3, no fixed cap.
- `visibleOnly`: drop invisible elements from the first-level list (subtrees keep their structure).
- `maxChars`: per-segment character truncation for text mode (omitted = no truncation).

Result is discriminated by `mode`:

```ts
type ExtractResult =
  | { mode: 'text'; snapshot: PageSnapshot } // no selector, whole page
  | { mode: 'text'; texts: string[]; total: number; offset?; limit? } // with selector, per first-level element
  | { mode: 'structured'; nodes: DomNode[]; total: number; offset?; limit?; truncated?: boolean } // DOM tree (maxNodes=500 budget, BFS truncation)
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

`article` uses the `defuddle/full` bundle and returns `content` as **Markdown** (the core `defuddle` bundle silently ignores `markdown: true`). Metadata is returned as separate fields; the CLI prints it as YAML frontmatter.

### In-page Network (executed in the real page context, with login state)

| Command  | Params                                                                                | Returns data                                                                   | Write       |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------- |
| `fetch`  | `url`, `method?`, `headers?`, `body?`, `returnType?`                                  | `{ status, statusText?, headers, body }`                                       | conditional |
| `search` | `query`, `engine?` (google\|duckduckgo; default google), `page?` (1-based, default 1) | `{ results: [{ title, url, snippet? }], pagination: { query, engine, page } }` | never       |

> Pagination note: `page` offsets results per engine — **google supports it** (10/page, verified on real Chrome). The DuckDuckGo **html endpoint ignores the offset**, so `duckduckgo` with `page > 1` re-returns page 1; prefer the default `google` engine when paging.

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

### Session

| Command      | Params | Returns data                                    | Write |
| ------------ | ------ | ----------------------------------------------- | ----- |
| `ping`       | —      | `{ pong, protocolVersion, extensionConnected }` | never |
| `get-status` | —      | `{ extensionConnected, sessions, config }`      | never |

### Advanced (disabled by default)

| Command | Params       | Returns data | Write  |
| ------- | ------------ | ------------ | ------ |
| `eval`  | `expression` | `{ value }`  | always |

`eval` is disabled by default (it is in `PARKINGLOT_DISABLED_COMMANDS`); when disabled the server returns `EVAL_DISABLED`.

## Events (v1 minimal set)

| Event                                            | Direction          | Trigger                   | Purpose                                         |
| ------------------------------------------------ | ------------------ | ------------------------- | ----------------------------------------------- |
| `extension.connected` / `extension.disconnected` | server → extension | extension WS state change | logs, status                                    |
| `extension.tab-activated`                        | extension → server | tab activation            | server tracks "most recent active tab" fallback |
| `page.navigated`                                 | extension → server | top-frame navigation done | audit                                           |
| `tab.created`                                    | extension → server | a tab is created          | server event cache / unread count               |
| `tab.removed`                                    | extension → server | a tab is closed           | session tab unbinding + event cache             |

`tab.created` / `tab.removed` are cached in memory (last 100) and surfaced by `plt events` / `GET /api/events`; command responses carry the unread count. When a session's tab is removed, the binding is cleared and the next command falls back to the most recently active tab.

`Network.*` is an extension point: page-level network events are not implemented.

## Error Codes

| code                                                                          | meaning                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------ |
| `INVALID_REQUEST` / `INVALID_PARAMS` / `UNKNOWN_METHOD` / `MESSAGE_TOO_LARGE` | envelope/params validation failed          |
| `EXTENSION_OFFLINE` / `EXTENSION_NO_TAB`                                      | extension not connected / no operable tab  |
| `SESSION_NOT_FOUND` / `SESSION_TAB_CLOSED`                                    | session missing / its tab is closed        |
| `TIMEOUT`                                                                     | command timed out (default 30 s)           |
| `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`                                       | locator matched nothing / several elements |
| `TAB_NOT_ACTIVE`                                                              | element screenshot on a non-active tab     |
| `URL_INVALID` / `HOST_NOT_ALLOWED`                                            | invalid URL / host not in allowlist        |
| `EVAL_DISABLED`                                                               | eval not enabled                           |
| `INTERNAL`                                                                    | catch-all error                            |

## Validation (Postel's Law)

- **Be conservative in what you send**: schemas are exact per-command (`packages/protocol/src/schemas.ts`).
- **Be liberal in what you accept**: unknown fields are stripped; optional fields default; `validateParams(method, params)` returns normalized params.
- Both ends (server Router and extension) must use the same schemas.

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
interface SessionInfo {
  id: string;
  tabId?: number;
  createdAt: string;
  lastUsedAt: string;
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
```
