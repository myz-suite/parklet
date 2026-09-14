---
name: parkinglot
description: 'Control a real Chrome browser through ParkingLot (parkinglot-server + parkinglot-extension). Use whenever a task needs browser automation: opening pages, clicking, typing, scrolling, extracting readable content, taking screenshots, searching the web, or making page-context network requests (with login state).'
---

# ParkingLot

Drive a real browser owned by the human user. The agent sends CLI commands to a local relay; a Chrome extension executes them in the actual page (login state, cookies, anti-bot realism included).

```
Agent ── plt <command> ──▶ parkinglot-server (ws://127.0.0.1:8787) ──WebSocket──▶ parkinglot-extension ──▶ page
```

## 1. Prerequisites (one-time)

1. Install & run the relay: `npm install -g @parkinglot/server`, then `plt serve` (node ≥ 20). Note the printed **pair token** and ws path (`ws://127.0.0.1:8787/ws`).
2. Install the extension from the Chrome Web Store (<https://chromewebstore.google.com/detail/ajpkphgdonekdpifjhfffffjhikiafdj>), open its popup, enter the server URL and token, **Save & Connect** — wait for green **Connected ✓**.
3. Verify: `plt status` → `extension: connected ✅`.

Config via env (defaults safe): `PARKINGLOT_PORT=8787`, `PARKINGLOT_BIND=127.0.0.1`, `PARKINGLOT_TOKEN`, `PARKINGLOT_ALLOWED_HOSTS` (comma list), `PARKINGLOT_DISABLED_COMMANDS`. `eval` stays disabled unless you set `PARKINGLOT_ENABLE_EVAL=1` (an explicit `eval` entry in `PARKINGLOT_DISABLED_COMMANDS` always wins).

The extension's toolbar icon shows a status badge — **green** = connected, **red** = disconnected (server not running / dropped), **orange** = not configured or bad token. The popup shows guidance and a **Retry** button; a wrong token stops auto-reconnect until you fix the config.

## 2. Commands (full reference: `references/protocol.md`; worked examples: `references/example.md`)

Navigation/state: `plt status`, `plt ping`, `plt goto <url>`, `plt back`, `plt forward`, `plt reload`
Interact: `plt click <css>`, `plt click-text <text>`, `plt fill <css> <value>`, `plt type <css> <text>`, `plt press <key|combo>` (e.g. `Control+c`), `plt hover <css>`, `plt select <css> --value <v>`, `plt selection [--selector <css> | --text <text>]` (select text, returns the selected string)
View: `plt scroll <up|down|top|bottom|amount>`, `plt scroll --selector <css> [--direction d] [--amount n]` (scroll inside an element), `plt scroll-to <css>` (bring element into view), `plt screenshot [--path out.png] [--selector <css>] [--format png|jpeg]`
Extract: `plt extract [--selector <css>] [--mode text|structured|html] [--article] [--depth N] [--offset N] [--limit N] [--max-chars N] [--exclude <css>] [--visible-only] [--prettify]`, `plt page-info`, `plt dom-query [<css> | --text <s>] [--limit N]` (list matching elements), `plt links [--selector <css>] [--limit N] [--offset N] [--all]` (visible links grouped by href), `plt forms [--selector <css>] [--limit N] [--offset N] [--all]` (visible form fields grouped by form), `plt tabs`, `plt tab <id>`, `plt tab-new <url>`, `plt tab-close`
Advanced: `plt eval "<script>" | --file <path> | --stdin` (runs a script in the page; must contain `return`; server must set `PARKINGLOT_ENABLE_EVAL=1`)
Network in page: `plt fetch <url> [--method POST] [--header "k: v"] [--body ...]`, `plt search <query> [--engine google|duckduckgo] [--page N]` (default engine google; paging via --page)
Wait: `plt wait [--ms N | --selector css | --condition load]`
Ops: `plt logs [--follow]`, `plt events [--tail N]` (tab lifecycle events; clears the unread count), `plt run <file.jsonl|->` (batch: one `{method, params?, tabId?}` per line; `--fail-fast`)

Global flags: `--server <url>`, `--json`, `--timeout <ms>`, `--tab <id>`.

Notes:

- `plt screenshot` without `--path` writes `screenshot-<timestamp>.<png|jpeg>` in the cwd and prints the absolute path.
- `plt extract --article` returns **Markdown** with YAML frontmatter (`title`/`site`/`url`/…); `--selector` becomes the article content selector.
- `plt extract --mode structured --selector …` returns a DOM tree with `total` + echoed `offset`/`limit` — page with `offset += limit` until `offset + nodes.length >= total`.
- `plt press` supports Playwright-style keys/combos (`Control+c`, `Meta+s`, `ArrowDown`, `Enter`, …).
- `plt links` groups anchors by absolute `href` (`texts[]` + `count`); `plt forms` groups fields by form `action`/`method`/`target` and includes `name`/`type`/`value`/`labels`/`checked`/`selected` (passwords are masked as `********`). Both default to visible-only (`--all` to override) and page with `--limit`/`--offset` (`total` is the number of href groups for links, and the number of fields for forms).
- `plt eval` runs the script in the page's **MAIN world** (it can read page globals, but a strict-CSP page can block it); it must `return`, the result must be JSON-serializable (otherwise `NOT_SERIALIZABLE`), and `undefined` yields no value. Disabled by default.

## 3. Continuity model (IMPORTANT)

- **Current tab** = the server's default target. The first `plt goto` sets it; later commands reuse it. Override per command with `--tab <id>`.
- **tabId** = physical tab. **navId** increments on every navigation. If the current tab is closed, the server clears it and the next command falls back to the most recently active tab.
- Every response carries a `context` snapshot `{url, title, navId, tabId}`. **If `context.url` or `context.navId` changed between commands, the page changed** — re-check before acting on stale content.

## 4. Standard workflows

Research: `plt search "topic"` → pick a result URL → `plt goto <url>` → `plt extract` → `plt scroll down` → `plt extract` → repeat.
Form fill: `plt goto <login-url>` → `plt fill "#user" alice` → `plt fill "#pass" ***` → `plt click-text "Sign in"` → `plt wait --condition load` → `plt extract` (verify state).
Screenshot report: `plt goto <url>` → `plt scroll top` → `plt screenshot --path shot.png`.
Authenticated API: `plt fetch https://api.example.com/me --header "Accept: application/json"` (runs in the page, with cookies).

## 5. Troubleshooting

- `EXTENSION_OFFLINE`: extension not paired. Check popup (green dot) and that server is running with the same token.
- `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`: selector/text not found or ambiguous — use `plt extract` first to learn the page, prefer a more specific CSS selector. `fill`/`type` accept a label/container selector and resolve the input.
- `TAB_NOT_ACTIVE`: element screenshot (`--selector`) needs the target tab active — `plt tab <id>` first, or omit `--selector`.
- `TIMEOUT`: page slow — retry with `--timeout 60000`.
- `TAB_CLOSED`: the target tab was closed — run `plt goto <url>` or pass `--tab <id>` to pick a new one; later commands auto-fall back to the most recently active tab.

## 6. Security notes

- Server binds 127.0.0.1 only; the extension connection requires the pair token. Treat the token as a secret.
- `eval` is disabled by default; enable it deliberately with `PARKINGLOT_ENABLE_EVAL=1` and use with care (the server returns `EVAL_DISABLED` otherwise).
- The extension needs `host_permissions <all_urls>` — that is the inherent cost of controlling any page. The command ledger (`plt logs`) redacts credentials.
