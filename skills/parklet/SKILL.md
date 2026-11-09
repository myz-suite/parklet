---
name: parklet
description: 'Control a real Chrome browser through Parklet (parklet-server + parklet-extension). Use whenever a task needs browser automation: opening pages, clicking, typing, scrolling, extracting readable content, taking screenshots, searching the web, or making page-context network requests (with login state).'
---

# Parklet

Drive a real browser owned by the human user. The agent sends CLI commands to a local relay; a Chrome extension executes them in the actual page (login state, cookies, anti-bot realism included).

```
Agent ── plt <command> ──▶ parklet-server (ws://127.0.0.1:8787) ──WebSocket──▶ parklet-extension ──▶ page
```

## 1. Prerequisites (one-time)

1. Install & run the relay: `npm install -g @parklet/server`, then `plt serve` (node ≥ 20). Note the printed **pair token** and ws path (`ws://127.0.0.1:8787/ws`).
2. Install the extension from the Chrome Web Store (<https://chromewebstore.google.com/detail/ajpkphgdonekdpifjhfffffjhikiafdj>), open its popup, enter the server URL and token, **Save & Connect** — wait for green **Connected ✓**.
3. Verify: `plt status` → `extension: connected ✅`.

Config via env (defaults safe): `PARKLET_PORT=8787`, `PARKLET_BIND=127.0.0.1`, `PARKLET_TOKEN`, `PARKLET_ALLOWED_HOSTS` (comma list), `PARKLET_DISABLED_COMMANDS`. `eval` stays disabled unless you set `PARKLET_ENABLE_EVAL=1` (an explicit `eval` entry in `PARKLET_DISABLED_COMMANDS` always wins).

The extension's toolbar icon shows a status badge — **green** = connected, **red** = disconnected (server not running / dropped), **orange** = not configured or bad token. The popup shows guidance and a **Retry** button; a wrong token stops auto-reconnect until you fix the config.

## 2. Commands (full reference: `references/protocol.md`; worked examples: `references/example.md`)

Navigation/state: `plt status`, `plt ping`, `plt goto <url>`, `plt back`, `plt forward`, `plt reload`
Interact: `plt click <css>`, `plt click-text <text> [--within <css>] [--role <role>] [--exact] [--nth <n>]` (only actionable elements), `plt fill <css> <value>`, `plt type <css> <text>`, `plt press <key|combo>` (e.g. `Control+c`), `plt hover <css>`, `plt select <css> --value <v>`, `plt selection [--selector <css> | --text <text>]` (select text, returns the selected string)
View: `plt scroll --by <px>` / `plt scroll --to top|bottom` (instant + settle by default), `plt scroll --selector <css> --by <px>` (scroll inside an element), `plt scroll-to <css>` (bring element into view), `plt screenshot [--path out.png] [--selector <css>] [--format png|jpeg]`
Extract: `plt extract [--selector <css>] [--mode text|structured|html|links|forms] [--fields "<spec>"] [--fields-file <path>] [--article] [--depth N] [--offset N] [--limit N] [--max-chars N] [--exclude <css>] [--visible-only|--all]`, `plt page-info [--selector <css>]`, `plt dom-query [<css> | --text <s>] [--limit N]` (list matching elements), `plt tabs`, `plt tab <id>` (activate + make current), `plt tab-new <url>`, `plt tab-close [id]`
Advanced: `plt eval "<script>" | --file <path> | --stdin` (runs a script in the page; must contain `return`; server must set `PARKLET_ENABLE_EVAL=1`)
Network in page: `plt fetch <url> [--method POST] [--header "k: v"] [--body ...]`, `plt search <query> [--engine google|duckduckgo] [--page N]` (default engine google; paging via --page)
Wait: `plt wait [--ms N | --selector <css> [--count N] [--stable <ms>] | --condition load|networkidle|content]`
Ops: `plt logs [--follow]`, `plt events [--tail N]` (tab lifecycle events; clears the unread count), `plt run <file.jsonl|->` (batch: one `{method, params?, tabId?, as?}` per line; `--var k=v`, `--fail-fast`), `plt collect <row-selector> --fields ... --repeat N [--scroll-by N] [--json|--jsonl]` (fixed-round extraction + scroll + dedupe)

Global flags: `--server <url>`, `--json`, `--timeout <ms>`, `--tab <id>`.

Notes:

- `plt screenshot` without `--path` writes `screenshot-<timestamp>.<png|jpeg>` in the cwd and prints the absolute path.
- `plt extract --article` returns **Markdown** with YAML frontmatter (`title`/`site`/`url`/…); `--selector` becomes the article content selector.
- `plt extract --mode structured --selector …` returns a DOM tree with `total` + echoed `offset`/`limit` — page with `offset += limit` until `offset + nodes.length >= total`.
- `plt press` supports Playwright-style keys/combos (`Control+c`, `Meta+s`, `ArrowDown`, `Enter`, …).
- `plt extract --mode links` groups anchors by absolute `href` (`texts[]` + `count`); `plt extract --mode forms` groups fields by form `action`/`method`/`target` and includes `name`/`type`/`value`/`labels`/`checked`/`selected` (passwords are masked as `********`). Both default to visible-only (`--all` to override) and page with `--limit`/`--offset`.
- `plt extract --selector "article[data-testid='tweet']" --fields "author=.author,datetime=time@datetime,text=.text"` returns one record per row selector; missing fields are `null`; `@href`/`@src` are absolute.
- `plt collect` is CLI orchestration over `extract --fields` + `scroll`; `--repeat` is required and must be ≥ 1. It reports `steps`, `duplicates`, `zeroNewSteps`, `stoppedReason` and an informational `observed` time range (not a coverage guarantee).
- `plt eval` runs the script in the page's **MAIN world** (it can read page globals, but a strict-CSP page can block it); it must `return`, the result must be JSON-serializable (otherwise `NOT_SERIALIZABLE`), and `undefined` yields no value. Disabled by default.

## 3. Continuity model (IMPORTANT)

- **Current tab** = the server's default target. The first `plt goto` sets it; later commands reuse it. Override per command with `--tab <id>`; a successful targeted command writes that tab back as current. `plt tabs` seeds the target from the browser-active tab only when none exists; later manual tab activation changes only the fallback and does not replace the selected current target.
- **tabId** = physical tab. **navId** increments on every navigation. If the current tab is closed, the server clears it and the next command falls back to the most recently active tab.
- `plt tabs` prints `*` for the browser-active tab in each Chrome window (multiple windows can each show `*`; it does not mean that window is focused) and `>` for the server current target; they can differ after `--tab`.
- Every response carries a `context` snapshot `{url, title, navId, tabId}`. **If `context.url` or `context.navId` changed between commands, the page changed** — re-check before acting on stale content.

## 4. Standard workflows

Research: `plt search "topic"` → pick a result URL → `plt goto <url>` → `plt extract` → `plt scroll --by 850` → `plt extract` → repeat.
Form fill: `plt goto <login-url>` → `plt fill "#user" alice` → `plt fill "#pass" ***` → `plt click-text "Sign in"` → `plt wait --condition load` → `plt extract` (verify state).
Screenshot report: `plt goto <url>` → `plt scroll --to top --allow-noop` → `plt screenshot --path shot.png`.
Authenticated API: `plt fetch https://api.example.com/me --header "Accept: application/json"` (runs in the page, with cookies).

## 5. Troubleshooting

- `EXTENSION_OFFLINE`: extension not paired. Check popup (green dot) and that server is running with the same token.
- `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`: selector/text not found or ambiguous — use `plt extract` first to learn the page, prefer a more specific CSS selector. `fill`/`type` accept a label/container selector and resolve the input.
- `TAB_NOT_ACTIVE`: deprecated; element screenshots now auto-activate the target tab (`--restore-focus` switches back).
- `TIMEOUT`: page slow — retry with `--timeout 60000`.
- `TAB_CLOSED`: the target tab was closed — run `plt goto <url>` or pass `--tab <id>` to pick a new one; later commands auto-fall back to the most recently active tab.

## 6. Security notes

- Server binds 127.0.0.1 only; the extension connection requires the pair token. Treat the token as a secret.
- `eval` is disabled by default; enable it deliberately with `PARKLET_ENABLE_EVAL=1` and use with care (the server returns `EVAL_DISABLED` otherwise).
- The extension needs `host_permissions <all_urls>` — that is the inherent cost of controlling any page. The command ledger (`plt logs`) redacts credentials.
