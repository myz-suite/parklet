# AGENTS.md

## Project

ParkingLot — Agent-controlled browser infrastructure. An AI agent drives a real Chrome browser by sending commands through a local relay daemon to a browser extension.

```
Agent ── CLI (plt) / HTTP ──▶ parkinglot-server (relay) ── WebSocket ──▶ parkinglot-extension (Chrome MV3) ──▶ pages
```

Authoritative design: `docs/initial-plan.md` (protocol, command set, session/tab/navId continuity model, security, acceptance criteria); v2 changes in `docs/v2-incremental-plan.md`.

## Repository (pnpm workspace)

| Path                 | Package                 | Role                                                                           |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `packages/protocol`  | `@parkinglot/protocol`  | Message envelope, command set, common types, Zod validation                    |
| `packages/server`    | `@parkinglot/server`    | Relay daemon: WS server, CLI, current-tab routing, event cache, command ledger |
| `packages/extension` | `@parkinglot/extension` | Chrome MV3: WS client, content-script executor, popup console                  |

Project skills (already installed): `.agents/skills/` — bootstrapping, probing, challenge, review, agent-facing-doc, etc.

## Commands

```bash
pnpm install        # install workspace deps (pnpm >= 9; builds gated via allowBuilds in pnpm-workspace.yaml)
pnpm typecheck      # tsc --noEmit across packages
pnpm test           # vitest run across packages
pnpm test:e2e       # Playwright E2E (tests/e2e): real extension via bundled Chromium + storage auto-pair; needs `pnpm exec playwright install chromium`
pnpm build          # tsc emit to packages/*/dist
pnpm lint           # eslint . (flat config)
pnpm format         # prettier --write .
```

## Conventions

- TypeScript strict, ESM (`"type": "module"`, `NodeNext` resolution), Node >= 20.
- Tests: `src/*.test.ts` next to source, vitest; run per package.
- Commits: Conventional Commits (`feat/fix/chore/docs/...`).
- Formatting: Prettier (100 cols, single quotes); lint via typescript-eslint.
- Security invariants: server binds `127.0.0.1` + token pairing; `eval` disabled by default; extension manifest states the cost of `host_permissions <all_urls>`.

## Versioning

- **Package versions are kept in lockstep.** All published components — `@parkinglot/protocol`, `@parkinglot/server`, `@parkinglot/extension` — share the **same** `version` (currently `0.2.0`) and are bumped together; `packages/extension/manifest.json` uses the same value. The root `package.json` is private (not published) and is not part of this rule.
- **`PROTOCOL_VERSION` is a separate concept** (`packages/protocol/src/constants.ts`), not the npm package version. It describes the wire protocol between CLI/HTTP ↔ server ↔ extension and is intentionally a **draft while the protocol is still in design**: currently `0.1.0-draft`. (Under SemVer, `0.x` already means "unstable"; the `-draft` suffix makes it explicit.)
- `plt --version` prints `<package version> (protocol <PROTOCOL_VERSION>)`, e.g. `0.2.0 (protocol 0.1.0-draft)`; `ping.protocolVersion` returns the wire version.
- Bumping `PROTOCOL_VERSION`: additive wire changes → minor, breaking wire changes → major; drop `-draft` when the protocol stabilizes. No runtime compatibility check exists yet — the constant is currently informational.

## Current status

All 5 phases of `docs/initial-plan.md` are complete, plus the v2 increment (`docs/v2-incremental-plan.md`) and the v3 increment (`docs/v3-incremental-plan.md`): HITL removed, extract gained selector/structured/article (defuddle), fill/type input resolution, press combos, element screenshots, current-tab close fallback, and a tab-lifecycle event cache (`plt events`); v3 adds an upgraded `eval` (full script run in the page **MAIN world**, JSON-serializable result, `NOT_SERIALIZABLE` — isolated-world eval is impossible under the MV3 CSP), Google search snippets, `plt selection`, and `plt links` / `plt forms` (visible-only by default, grouped, paged). The **session concept was removed** (it leaked a session per `goto`): commands now target an explicit `--tab` or the server's single **current tab** (auto-cleared when its tab closes, falling back to the most recently active tab). Package versions are `0.3.0`. Everything is green (typecheck/test/build/lint/format). A MAIN-world content script (`content-main.js`) backfills legacy keyboard `keyCode` for `press`. `extract --article` uses the `defuddle/full` bundle for Markdown output; esbuild `minify` is on (`content.js` ≈760 KB, `background.js` ≈11 KB). `eval` is enabled only with `PARKINGLOT_ENABLE_EVAL=1` (an explicit `eval` entry in `PARKINGLOT_DISABLED_COMMANDS` wins). The popup shows a connection-status badge (green/red/orange) driven by `status.ts`, and `plt serve` shuts down gracefully on Ctrl+C (`close(1001)` + `closeAllConnections()`). The v4 increment (`docs/v4-incremental-plan.md`) adds tool-UX improvements: `extract --exclude <css>`, `scroll --selector` now scrolls inside an element (plus `scroll-to`), the `dom-query` exploration command, and `plt run` batch execution (`docs/v4-incremental-plan.md`).

To run the system end-to-end: `npm install -g @parkinglot/server` → `plt serve` → install the extension from the Chrome Web Store and pair it in the popup → use `plt <command>` (see `parkinglot` skill; protocol reference: `skills/parkinglot/references/protocol.md`). Agent side: `npx skills add myz-suite/parkinglot --skill parkinglot`. From source: `pnpm install && pnpm build` → `pnpm --filter @parkinglot/server start` + load `packages/extension/dist` unpacked.

Keep-alive: SW holds the WS connection; `chrome.alarms` (0.5 min) wakes the SW to reconnect when Chrome reclaims it. Verified on real Chrome (stays online after 85s+70s idle). Stronger fallback if ever needed: move the WebSocket to an offscreen document.
