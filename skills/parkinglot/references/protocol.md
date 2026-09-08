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
pl goto <url>          # no session → auto-created and remembered; response carries sessionId/tabId/context
pl click "Submit"      # acts on the last session by default
pl session list|use|new|close
```

## Command Set

Write-access markers drive HITL: `always` = needs approval; `never` = read-only; `conditional` = depends on parameters.

### Navigation

| Command   | Params                                                       | Returns data               | Write  |
| --------- | ------------------------------------------------------------ | -------------------------- | ------ |
| `goto`    | `url` (http/https), `waitUntil?` (`load`/`domcontentloaded`) | — (context is the product) | always |
| `back`    | —                                                            | —                          | always |
| `forward` | —                                                            | —                          | always |
| `reload`  | —                                                            | —                          | always |

### Interaction

| Command      | Params                                       | Returns data               | Write  |
| ------------ | -------------------------------------------- | -------------------------- | ------ |
| `click`      | `selector` (CSS)                             | `{ element: ElementInfo }` | always |
| `click-text` | `text` (visible text, fuzzy match + dedup)   | `{ element }`              | always |
| `fill`       | `selector`, `value` (whole-value replace)    | `{ element }`              | always |
| `type`       | `selector`, `text` (per keystroke)           | `{ element }`              | always |
| `press`      | `selector?`, `key`                           | `{ element }`              | always |
| `hover`      | `selector`                                   | `{ element }`              | always |
| `select`     | `selector`, `value?`/`label?` (at least one) | `{ element }`              | always |

### Scroll / View

| Command      | Params                                                                   | Returns data               | Write  |
| ------------ | ------------------------------------------------------------------------ | -------------------------- | ------ |
| `scroll`     | `direction?` (up/down/top/bottom), `amount?`, `selector?` (at least one) | `{ viewport }`             | always |
| `screenshot` | `format?` (png/jpeg), `fullPage?`, `path?`                               | `{ data?: base64, path? }` | never  |

### Extraction

| Command         | Params                                      | Returns data                                                     | Write |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------- | ----- |
| `extract`       | `mode?` (text/structured), `limit?` (chars) | `{ snapshot: PageSnapshot }` (visible text + viewport + scrollY) | never |
| `get-page-info` | —                                           | `{ url, title, viewport, scrollY }`                              | never |

### In-page Network (executed in the real page context, with login state)

| Command  | Params                                               | Returns data                              | Write       |
| -------- | ---------------------------------------------------- | ----------------------------------------- | ----------- |
| `fetch`  | `url`, `method?`, `headers?`, `body?`, `returnType?` | `{ status, statusText?, headers, body }`  | conditional |
| `search` | `query`, `engine?`                                   | `{ results: [{ title, url, snippet? }] }` | never       |

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

`eval` requires `PARKINGLOT_ENABLE_EVAL=1` and session `mode: trust`; otherwise `EVAL_DISABLED`.

## Events (v1 minimal set)

| Event                                            | Direction          | Trigger                   | Purpose                                         |
| ------------------------------------------------ | ------------------ | ------------------------- | ----------------------------------------------- |
| `extension.connected` / `extension.disconnected` | server → extension | extension WS state change | logs, status                                    |
| `extension.tab-activated`                        | extension → server | tab activation            | server tracks "most recent active tab" fallback |
| `page.navigated`                                 | extension → server | top-frame navigation done | audit, (future) long-running agent push         |
| `approval.requested`                             | server → extension | write op entered HITL     | popup approval queue                            |
| `approval.respond`                               | extension → server | popup approve/deny        | server writes back to ApprovalManager           |
| `approval.responded`                             | (reserved)         | HITL state change         | future event streams                            |

`Network.*` is an extension point: page-level network events are not implemented in v1.

## Error Codes

| code                                                                          | meaning                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------ |
| `INVALID_REQUEST` / `INVALID_PARAMS` / `UNKNOWN_METHOD` / `MESSAGE_TOO_LARGE` | envelope/params validation failed          |
| `EXTENSION_OFFLINE` / `EXTENSION_NO_TAB`                                      | extension not connected / no operable tab  |
| `SESSION_NOT_FOUND` / `SESSION_TAB_CLOSED`                                    | session missing / its tab is closed        |
| `TIMEOUT`                                                                     | command timed out (default 30 s)           |
| `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`                                       | locator matched nothing / several elements |
| `URL_INVALID` / `HOST_NOT_ALLOWED`                                            | invalid URL / host not in allowlist        |
| `EVAL_DISABLED`                                                               | eval not enabled                           |
| `PENDING_APPROVAL` / `APPROVAL_DENIED` / `APPROVAL_TIMEOUT`                   | HITL: pending / denied / timed out         |
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
  mode: 'auto' | 'ask';
  createdAt: string;
  lastUsedAt: string;
}
interface Viewport {
  width: number;
  height: number;
}
```
