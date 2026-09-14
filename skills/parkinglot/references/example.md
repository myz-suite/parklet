# ParkingLot — Worked Examples

Companion to [`protocol.md`](./protocol.md). Examples use the `plt` CLI; add `--json` to any
command for the raw envelope (`{ sessionId, tabId, context, data }`). Sample outputs are
illustrative — URLs/ids/timings differ.

## Session & continuity

```bash
plt goto https://example.com
# 📍 https://example.com — Example Domain (navId=1, tab=7, session=pl-3c60af04)

plt extract                 # reuses the default session; context is the proof it stayed put
# 📍 https://example.com — Example Domain (navId=1, tab=7, session=pl-3c60af04)
# Example Domain
# This domain is for use in illustrative examples ...
# [viewport 1512x857]

plt click-text "More information"   # real click → navigation
# ⚡ <a> More information @(320,180)
# 📍 https://www.iana.org/help/example-domains — ... (navId=2, tab=7, session=pl-3c60af04)
```

`context.navId` increments on navigation and `context.url` changes — an agent can always tell
whether the page moved. Manage the logical target with `plt session list|new|use|close`.

## Extract

### Plain text

```bash
plt extract
# 📍 https://example.com — Example Domain (navId=1, tab=7, session=pl-…)
# Example Domain
# ...
# [viewport 1512x857]

plt extract --max-chars 500   # per-segment character cap (omitted = no truncation)
```

### Text of a list

```bash
plt extract --selector "article ul li"
# [1] First item
# [2] Second item
# [3] Third item
```

### Structured DOM tree + pagination

```bash
plt extract --mode structured --selector "article ul" --limit 10
# [{"tag":"li","attrs":{},"children":[{"tag":"a","attrs":{"href":"/item/1","title":"First item"},"children":[],"text":"First item"}]}, ...]
# [showing 10 of 25, limit=10]

plt extract --mode structured --selector "article ul" --offset 10 --limit 10 --prettify
# …pretty-printed JSON…
# [showing 10 of 25, offset=10, limit=10]
```

- `total` is the first-level element count (after `visibleOnly`, before paging): iterate
  `offset += limit` until `offset + nodes.length >= total`.
- `depth` (default 3) is the recursion depth **below** each root; `maxNodes=500` caps the
  tree (BFS truncation, `truncated: true`).
- `--visible-only` filters invisible first-level elements; `--limit`/`--offset` are element
  counts (use `--max-chars` for characters).

### Article (Markdown)

```bash
plt extract --article
# ---
# title: Example Article
# site: Example Domain
# domain: example.com
# url: https://example.com/article
# language: en
# wordCount: 128
# description: An example article.
# ---
#
# ## Section heading
# Body paragraph with **bold** text and a [link](https://example.com/docs).
```

`--article` returns **Markdown**; an optional `--selector` restricts extraction to that
element. Metadata is emitted as YAML frontmatter.

## Screenshot

```bash
plt screenshot
# 📸 saved to /Users/you/screenshot-20260914-164000.png

plt screenshot --path hero.png --selector "#hero"   # crop a single element
# 📸 saved to /Users/you/hero.png
```

- Without `--path`, the file is written to the current directory as
  `screenshot-<timestamp>.<png|jpeg>` (`--format` chooses the suffix) and the absolute path
  is printed.
- Element screenshots require the target tab to be its window's active tab, otherwise
  `TAB_NOT_ACTIVE` (`plt tab <id>` first). The element is scrolled (instantly) into view and
  the visible part is cropped (`devicePixelRatio`/zoom aware; no stitching).

## Interaction

```bash
plt fill "#username" alice          # set value + input/change
plt fill "form" alice               # selector may be a label/container → resolved to its input
plt type "#search" "hello world"    # per keystroke (fires input); label/container also resolved

plt click "#submit"
plt click-text "Sign in"
plt select "#country" --label "Japan"
plt hover "#menu"
plt scroll down
plt scroll --selector "#sidebar" --amount 200
```

Keys and combos (Playwright-style):

```bash
plt press Enter
plt press ArrowDown
plt press Control+a        # Ctrl/Cmd+A, Backspace/Delete, Arrow/Home/End default actions emulated
plt press Meta+s
plt press Shift+Tab
plt press Tab --selector "#email"
```

`press` dispatches the full `keydown`/`keypress`/`keyup` sequence with legacy key codes
backfilled for pages that read `keyCode` (such as Google suggestions), and emulates common
default actions. Events are synthetic (untrusted): IME/rich editors can still differ from
real keystrokes. Unknown multi-character keys return `INVALID_PARAMS`.

### Fill/type input resolution

`selector` may target the input itself, a `<label for=…>`, a wrapping label/fieldset, or a
container. Resolution order: self-editable → `label[for]` → nearest label/fieldset (unique
input) → unique descendant; several candidates without a `label[for]` → `TARGET_AMBIGUOUS`.

## Search & in-page network

```bash
plt search "playwright vs puppeteer"
# [google · page 1 of "playwright vs puppeteer" — 用 --page 2 取下一页]
# 1. Playwright vs Puppeteer ...
#    https://...
#    ...
plt search "playwright" --engine duckduckgo --page 1

plt fetch https://api.github.com/user --header "Accept: application/json"
# HTTP 200
# {"login":"...","id":...}
```

`fetch` runs in the page context (cookies/login state), default `credentials: 'same-origin'`.

## Tabs & events

```bash
plt tabs
# 7   Example Domain  https://example.com
# 9*  Another page    https://...
plt tab 9
plt tab-new https://example.org
plt tab-close 9

plt events
# 2026-09-14T08:00:00.000Z  tab.created  tab=9 win=1 https://example.org
# 2026-09-14T08:01:00.000Z  tab.removed  tab=9 win=1

plt logs --tail 20            # command ledger (JSON lines, secrets redacted)
```

Any command with pending `tab.*` events appends a reminder: `🔔 2 new events, run \`plt events\``.
If a session's tab is closed, its binding is cleared and the next command falls back to the
most recently active tab.

## Errors & exit codes

```bash
plt extract --selector "#nope"
# ✖ [TARGET_NOT_FOUND] no element matches '#nope'    (exit 3)
```

| Exit | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| 0    | success                                                                    |
| 2    | invalid request/params                                                     |
| 3    | target/session error (`TARGET_*`, `SESSION_*`, `TAB_NOT_ACTIVE`, URL/host) |
| 4    | extension offline / no tab (`EXTENSION_OFFLINE`, `EXTENSION_NO_TAB`)       |
| 6    | timeout                                                                    |
| 1    | other                                                                      |

Full code list and payload shapes: [`protocol.md`](./protocol.md).
