---
name: parkinglot
description: 'Control a real Chrome browser through ParkingLot (parkinglot-server + parkinglot-extension). Use whenever a task needs browser automation: opening pages, clicking, typing, scrolling, extracting readable content, taking screenshots, searching the web, or making page-context network requests (with login state). Triggers: "open a website", "click X", "fill the form", "extract page content", "take a screenshot", "search the web", "fetch a URL with cookies".'
---

# ParkingLot

Drive a real browser owned by the human user. The agent sends CLI commands to a local relay; a Chrome extension executes them in the actual page (login state, cookies, anti-bot realism included).

```
Agent ── pl <command> ──▶ parkinglot-server (ws://127.0.0.1:8787) ──WebSocket──▶ parkinglot-extension ──▶ page
```

## 1. Prerequisites (one-time)

1. Start the relay: `pnpm --filter @parkinglot/server start` (node ≥ 20). Note the printed **pair token** and ws path (`ws://127.0.0.1:8787/ws`).
2. Build and load the extension in Chrome:
   - `pnpm build` → `packages/extension/dist/`
   - Open `chrome://extensions`, enable **Developer mode**, **Load unpacked** → `packages/extension/dist`.
   - Open the extension popup, enter the server URL and token, **Save & Connect**. Wait for the green status dot.
3. Verify: `pl status` → `extension: connected ✅`.

Config via env (defaults safe): `PARKINGLOT_PORT=8787`, `PARKINGLOT_BIND=127.0.0.1`, `PARKINGLOT_TOKEN`, `PARKINGLOT_ALLOWED_HOSTS` (comma list), `PARKINGLOT_ENABLE_EVAL=1` (off by default).

## 2. Commands (full reference: `references/protocol.md`)

Navigation/state: `pl status`, `pl ping`, `pl goto <url>`, `pl back`, `pl forward`, `pl reload`
Interact: `pl click <css>`, `pl click-text <text>`, `pl fill <css> <value>`, `pl type <css> <text>`, `pl press <key>`, `pl hover <css>`, `pl select <css> --value <v>`
View: `pl scroll <up|down|top|bottom|amount>`, `pl screenshot --path out.png`
Extract: `pl extract [--limit N]`, `pl page-info`, `pl tabs`, `pl tab <id>`, `pl tab-new <url>`, `pl tab-close`
Network in page: `pl fetch <url> [--method POST] [--header "k: v"] [--body ...]`, `pl search <query>`
Wait/session: `pl wait [--ms N | --selector css | --condition load]`, `pl session list|new|use|close`
Ops: `pl logs [--follow]`, `pl approve <requestId>` / `pl deny <requestId>`

Global flags: `--server <url>`, `--json`, `--timeout <ms>`, `--session <id>`.

## 3. Continuity model (IMPORTANT)

- **Session** = the logical target. The first `pl goto` auto-creates one and it becomes the default; later commands reuse it. Manage with `pl session ...`.
- **tabId** = physical tab. **navId** increments on every navigation.
- Every response carries a `context` snapshot `{url, title, navId, tabId}`. **If `context.url` or `context.navId` changed between commands, the page changed** — re-check before acting on stale content.

## 4. Standard workflows

Research: `pl search "topic"` → pick a result URL → `pl goto <url>` → `pl extract` → `pl scroll down` → `pl extract` → repeat.
Form fill: `pl goto <login-url>` → `pl fill "#user" alice` → `pl fill "#pass" ***` → `pl click-text "Sign in"` → `pl wait --condition load` → `pl extract` (verify state).
Screenshot report: `pl goto <url>` → `pl scroll top` → `pl screenshot --path shot.png`.
Authenticated API: `pl fetch https://api.example.com/me --header "Accept: application/json"` (runs in the page, with cookies).

## 5. Troubleshooting

- `EXTENSION_OFFLINE`: extension not paired. Check popup (green dot) and that server is running with the same token.
- `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`: selector/text not found or ambiguous — use `pl extract` first to learn the page, prefer a more specific CSS selector.
- `PENDING_APPROVAL` / `APPROVAL_DENIED`: session runs in `ask` mode; user must approve in the popup (or `pl approve <id>`). Read-only commands never block.
- `TIMEOUT`: page slow — retry with `--timeout 60000`.
- `SESSION_NOT_FOUND`: the session's tab was closed or the server restarted — create a new one with `pl goto`.

## 6. Security notes

- Server binds 127.0.0.1 only; the extension connection requires the pair token. Treat the token as a secret.
- `eval` is disabled by default; enable only via `PARKINGLOT_ENABLE_EVAL=1` on the server and use with care.
- The extension needs `host_permissions <all_urls>` — that is the inherent cost of controlling any page. The command ledger (`pl logs`) redacts credentials.
