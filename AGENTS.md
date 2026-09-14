# AGENTS.md

## Project

ParkingLot — Agent-controlled browser infrastructure. An AI agent drives a real Chrome browser by sending commands through a local relay daemon to a browser extension.

```
Agent ── CLI (plt) / HTTP ──▶ parkinglot-server (relay) ── WebSocket ──▶ parkinglot-extension (Chrome MV3) ──▶ pages
```

Authoritative design: `docs/initial-plan.md` (protocol, command set, session/tab/navId continuity model, security, acceptance criteria); v2 changes in `docs/v2-incremental-plan.md`.

## Repository (pnpm workspace)

| Path                 | Package                 | Role                                                                        |
| -------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `packages/protocol`  | `@parkinglot/protocol`  | Message envelope, command set, common types, Zod validation                 |
| `packages/server`    | `@parkinglot/server`    | Relay daemon: WS server, CLI, session registry, event cache, command ledger |
| `packages/extension` | `@parkinglot/extension` | Chrome MV3: WS client, content-script executor, popup console               |

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

## Current status

All 5 phases of `docs/initial-plan.md` are complete, plus the v2 increment (`docs/v2-incremental-plan.md`): HITL removed, extract gained selector/structured/article (defuddle), fill/type input resolution, press combos, element screenshots, tab-close session fallback, and a tab-lifecycle event cache (`plt events`). Everything is green (typecheck/test/build/lint/format; 130 unit tests; E2E updated).

To run the system end-to-end: `npm install -g @parkinglot/server` → `plt serve` → install the extension from the Chrome Web Store and pair it in the popup → use `plt <command>` (see `parkinglot` skill; protocol reference: `skills/parkinglot/references/protocol.md`). Agent side: `npx skills add myz-suite/parkinglot --skill parkinglot`. From source: `pnpm install && pnpm build` → `pnpm --filter @parkinglot/server start` + load `packages/extension/dist` unpacked.

Keep-alive: SW holds the WS connection; `chrome.alarms` (0.5 min) wakes the SW to reconnect when Chrome reclaims it. Verified on real Chrome (stays online after 85s+70s idle). Stronger fallback if ever needed: move the WebSocket to an offscreen document.
