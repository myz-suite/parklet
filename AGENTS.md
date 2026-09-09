# AGENTS.md

## Project

ParkingLot — Agent-controlled browser infrastructure. An AI agent drives a real Chrome browser by sending commands through a local relay daemon to a browser extension.

```
Agent ── CLI (plt) / HTTP ──▶ parkinglot-server (relay) ── WebSocket ──▶ parkinglot-extension (Chrome MV3) ──▶ pages
```

Authoritative design: `docs/initial-plan.md` (protocol, command set, session/tab/navId continuity model, HITL, security, acceptance criteria).

## Repository (pnpm workspace)

| Path                 | Package                 | Role                                                                 |
| -------------------- | ----------------------- | -------------------------------------------------------------------- |
| `packages/protocol`  | `@parkinglot/protocol`  | Message envelope, command set, common types, Zod validation          |
| `packages/server`    | `@parkinglot/server`    | Relay daemon: WS server, CLI, session registry, HITL, command ledger |
| `packages/extension` | `@parkinglot/extension` | Chrome MV3: WS client, content-script executor, popup console        |

Project skills (already installed): `.agents/skills/` — bootstrapping, probing, challenge, review, agent-facing-doc, etc.

## Commands

```bash
pnpm install        # install workspace deps (pnpm >= 9; builds gated via allowBuilds in pnpm-workspace.yaml)
pnpm typecheck      # tsc --noEmit across packages
pnpm test           # vitest run across packages
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

All 5 phases of `docs/initial-plan.md` are complete: workspace skeleton → protocol layer → parkinglot-server (relay/CLI/HITL/ledger) → parkinglot-extension (MV3) → parkinglot skill + E2E smoke. Everything is green (typecheck/test/build/lint/format; 102 tests).

To run the system end-to-end: `pnpm --filter @parkinglot/server start` → build & load the extension from `packages/extension/dist` in Chrome → pair it in the popup → use `plt <command>` (see `parkinglot` skill; protocol reference: `skills/parkinglot/references/protocol.md`).

Keep-alive: SW holds the WS connection; `chrome.alarms` (0.5 min) wakes the SW to reconnect when Chrome reclaims it. Verified on real Chrome (stays online after 85s+70s idle). Stronger fallback if ever needed: move the WebSocket to an offscreen document.
