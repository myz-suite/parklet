# ParkingLot

**Drive a real browser owned by the human user.**

ParkingLot lets an AI agent control a real Chrome browser through a local relay. The agent sends `plt` commands (CLI or HTTP) to `parkinglot-server`, which forwards them over WebSocket to `parkinglot-extension` (Chrome MV3); the extension executes them in the user's own browser — with login state, cookies, and normal anti-bot behavior.

## Requirements

- Node.js ≥ 20
- Chrome / Chromium ≥ 120

## Install

### 1. Server

```bash
npm install -g @parkinglot/server
plt serve
```

`plt serve` prints a **pair token** and the WebSocket URL, then blocks:

```
parkinglot-server listening on http://127.0.0.1:8787
extension websocket: ws://127.0.0.1:8787/ws
pair token: 0123abcd…
```

The token is persisted (default `~/.parkinglot/token`), so it stays the same across restarts.

### 2. Extension

Install from the Chrome Web Store:

<https://chromewebstore.google.com/detail/ajpkphgdonekdpifjhfffffjhikiafdj>

### 3. Pair

Open the extension popup and fill in:

- **Server URL**: `http://127.0.0.1:8787`
- **Token**: the pair token printed by `plt serve`

Click **Save & Connect**. The toolbar icon shows a status badge — **green** = connected, **red** = disconnected, **orange** = not configured or bad token. The popup shows guidance and a **Retry** button. The settings are saved in `chrome.storage`, so Chrome reconnects automatically after a restart.

### 4. Verify

```bash
plt status        # extension: connected ✅
```

## Quick start

```bash
plt goto https://example.com    # navigate (auto-creates a session)
plt extract                     # readable page text
plt click-text "More information"
plt screenshot                  # saves ./screenshot-<timestamp>.png and prints the path
plt search "parkinglot"         # web search
```

## Agent skill

```bash
npx skills add myz-suite/parkinglot --skill parkinglot
```

## Documentation

- `skills/parkinglot/references/protocol.md` — command & protocol reference
- `skills/parkinglot/references/example.md` — worked examples
- `skills/parkinglot/SKILL.md` — agent-facing usage guide

## License

MIT
