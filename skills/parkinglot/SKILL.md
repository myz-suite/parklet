---
name: parkinglot
description: 'Control a real Chrome browser through ParkingLot (parkinglot-server + parkinglot-extension). Use whenever a task needs browser automation: opening pages, clicking, typing, scrolling, extracting readable content, taking screenshots, searching the web, or making page-context network requests (with login state). Triggers: "open a website", "click X", "fill the form", "extract page content", "take a screenshot", "search the web", "fetch a URL with cookies".'
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

Dev/from source: `pnpm install && pnpm build` → `pnpm --filter @parkinglot/server start`, and load `packages/extension/dist` unpacked (chrome://extensions → Developer mode → Load unpacked).

Config via env (defaults safe): `PARKINGLOT_PORT=8787`, `PARKINGLOT_BIND=127.0.0.1`, `PARKINGLOT_TOKEN`, `PARKINGLOT_ALLOWED_HOSTS` (comma list), `PARKINGLOT_ENABLE_EVAL=1` (off by default).

## 2. Commands (full reference: `references/protocol.md`)

Navigation/state: `plt status`, `plt ping`, `plt goto <url>`, `plt back`, `plt forward`, `plt reload`
Interact: `plt click <css>`, `plt click-text <text>`, `plt fill <css> <value>`, `plt type <css> <text>`, `plt press <key>`, `plt hover <css>`, `plt select <css> --value <v>`
View: `plt scroll <up|down|top|bottom|amount>`, `plt screenshot --path out.png`
Extract: `plt extract [--limit N]`, `plt page-info`, `plt tabs`, `plt tab <id>`, `plt tab-new <url>`, `plt tab-close`
Network in page: `plt fetch <url> [--method POST] [--header "k: v"] [--body ...]`, `plt search <query> [--engine google|duckduckgo] [--page N]` (default engine google; paging via --page)
Wait/session: `plt wait [--ms N | --selector css | --condition load]`, `plt session list|new|use|close`
Ops: `plt logs [--follow]`, `plt approve <requestId>` / `plt deny <requestId>`

Global flags: `--server <url>`, `--json`, `--timeout <ms>`, `--session <id>`.

## 3. Continuity model (IMPORTANT)

- **Session** = the logical target. The first `plt goto` auto-creates one and it becomes the default; later commands reuse it. Manage with `plt session ...`.
- **tabId** = physical tab. **navId** increments on every navigation.
- Every response carries a `context` snapshot `{url, title, navId, tabId}`. **If `context.url` or `context.navId` changed between commands, the page changed** — re-check before acting on stale content.

## 4. Standard workflows

Research: `plt search "topic"` → pick a result URL → `plt goto <url>` → `plt extract` → `plt scroll down` → `plt extract` → repeat.
Form fill: `plt goto <login-url>` → `plt fill "#user" alice` → `plt fill "#pass" ***` → `plt click-text "Sign in"` → `plt wait --condition load` → `plt extract` (verify state).
Screenshot report: `plt goto <url>` → `plt scroll top` → `plt screenshot --path shot.png`.
Authenticated API: `plt fetch https://api.example.com/me --header "Accept: application/json"` (runs in the page, with cookies).

## 5. Troubleshooting

- `EXTENSION_OFFLINE`: extension not paired. Check popup (green dot) and that server is running with the same token.
- `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`: selector/text not found or ambiguous — use `plt extract` first to learn the page, prefer a more specific CSS selector.
- `PENDING_APPROVAL` / `APPROVAL_DENIED`: session runs in `ask` mode; user must approve in the popup (or `plt approve <id>`). Read-only commands never block.
- `TIMEOUT`: page slow — retry with `--timeout 60000`.
- `SESSION_NOT_FOUND`: the session's tab was closed or the server restarted — create a new one with `plt goto`.

## 6. Security notes

- Server binds 127.0.0.1 only; the extension connection requires the pair token. Treat the token as a secret.
- `eval` is disabled by default; enable only via `PARKINGLOT_ENABLE_EVAL=1` on the server and use with care.
- The extension needs `host_permissions <all_urls>` — that is the inherent cost of controlling any page. The command ledger (`plt logs`) redacts credentials.
