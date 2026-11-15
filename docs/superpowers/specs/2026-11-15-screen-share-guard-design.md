# Screen-Share Guard — Design

Date: 2026-11-15
Status: Approved
Builds on: `2026-11-14-llm-redactor-design.md`, `2026-11-14-document-redaction-design.md`

## Intent

While the user is screen sharing from a web meeting app in Chrome (Google
Meet, Zoom web, Teams web, Discord web…), automatically replace sensitive
values (emails, phones, IPs, keys, cards, dictionary terms…) shown on **any**
web page with fake stand-ins, so viewers never see the real values. When the
share ends, pages go back to normal.

Success = demo: in a Meet call, start presenting a window/tab/screen; every
open tab (a cloud console, an email, a Claude chat) instantly shows
`jordan.lee@example.com`, `[IP_1]`, `[API_KEY_1]` instead of the real values;
stop presenting → originals return.

## Goals

- Detect shares started via `getDisplayMedia` in any tab (tab, window, or
  whole screen), and their end.
- While any share is active, in every tab and frame: replace sensitive text
  with the **same stand-ins the vault uses** (the user chose fake values over
  blur/labels).
- Never paint an original for even one frame after guarding is active.
- Manual on/off switch (popup + keyboard shortcut) as a fallback.
- Restore originals when guarding stops.

## Non-goals

- Detecting shares from native apps (Zoom desktop, OBS, OS sharing) — not
  observable from Chrome; the manual switch covers it.
- Shares already running before the extension loaded.
- Canvas-rendered text (Google Docs/Sheets body, maps), text in images/video,
  closed shadow roots, tooltips/attributes (`title`, `alt`, `placeholder`).
- Hover-to-peek (rejected: leaks when the hovered tab is the shared one).
- Identifying *which* tab is shared — all tabs are guarded while any share
  is active.

## Anti-goals

- A visible flash of an original value on the shared screen.
- Breaking pages: no DOM structure changes (no wrapping/splitting nodes that
  frameworks own), no rewriting of editable content.
- Guarding stuck on after the share ends (stale state after crashes).

## Approaches

**Where the fakes come from / how they're shown** — chosen: **rewrite page
text in place** (text node `nodeValue` swaps, reversible), with two
safeguards: (1) values without a stand-in yet are masked synchronously before
paint and swapped once the service worker assigns one; (2) editable fields
are blurred instead of rewritten. Rejected: drawing fake text in overlays
(fragile under scroll/reflow; misalignment shows originals); blur-only (user
chose fake values).

## Architecture

```
 any tab (all frames)                                   service worker
 ┌──────────────────────────────┐                      ┌───────────────────────────┐
 │ MAIN: share detector         │  share-started/ended │ share registry            │
 │  wraps getDisplayMedia,      │ ───── bridge ──────► │  shares: {tabId:id → kind}│
 │  track 'ended' + track.stop  │   (via ISOLATED)     │  + manual switch          │
 │                              │                      │  → storage.session        │
 │ ISOLATED: screen guard       │ ◄─ storage.session ─ │    guard = { active }     │
 │  when guard.active:          │      onChanged       │  action badge "SHARE"     │
 │   scan + MutationObserver    │                      │  tabs.onRemoved cleanup   │
 │   swap originals→stand-ins   │  redact-spans (new   │                           │
 │   mask unknowns, then swap   │ ───── values) ─────► │ vault (existing writer)   │
 │   blur sensitive fields      │                      └───────────────────────────┘
 └──────────────────────────────┘
```

### 1. Share detector (MAIN world, `<all_urls>`, all frames, `document_start`)

- Wrap `navigator.mediaDevices.getDisplayMedia`. On resolve, for each video
  track: report `share-started { shareId, surface }` (`surface` =
  `track.getSettings().displaySurface`: `browser | window | monitor`).
- Report `share-ended { shareId }` when the track fires `ended` **or** the
  page calls `track.stop()` (wrap `MediaStreamTrack.prototype.stop` for
  tracked display tracks — `stop()` does not fire `ended`).
- Reports go over the existing postMessage bridge pattern to the ISOLATED
  guard script, which forwards to the SW with `chrome.runtime.sendMessage`.

### 2. Share registry (service worker)

- `shares`: map `"<tabId>:<shareId>" → surface`, persisted in
  `chrome.storage.session` (survives SW restarts, cleared on browser restart).
- `manual`: boolean from the popup switch / keyboard command.
- `guard = { active: shares.size > 0 || manual }` written to
  `chrome.storage.session` (access level set to
  `TRUSTED_AND_UNTRUSTED_CONTEXTS` so content scripts can read it).
- `chrome.tabs.onRemoved` and frame navigation (`share-reset` sent by the
  detector on `pagehide`) drop that tab's shares, so a closed/crashed meeting
  tab can't leave guarding stuck on.
- Action badge text `"SHARE"` while active.
- Keyboard command `toggle-screen-guard`, default `Alt+Shift+H`.

### 3. Screen guard (ISOLATED world, `<all_urls>`, all frames, `document_start`)

Idle unless `guard.active`. Keeps a read-only copy of the vault + dictionary
(from `chrome.storage.local`, updated on change) and the detectors.

When active:
- **Scan**: walk all text nodes under `document.documentElement` (skip
  `script`, `style`, `noscript`, editable regions, extension nodes).
- **Per text node**: run detectors (no vault writes) to find sensitive spans.
  - Span original already in the vault → replace with its stand-in.
  - Not in the vault → replace with a same-length mask (`•`), and queue the
    original for `redact-spans` (batched, one request per animation frame);
    when stand-ins arrive (vault change), re-process masked nodes.
  - Write `nodeValue` only if it changed; remember
    `node → { original, applied }` in a `WeakMap`.
- **MutationObserver** (`childList`, `subtree`, `characterData`) processes
  added/changed nodes **synchronously in the observer callback** (a
  microtask, which runs before the next paint) — not via
  `requestAnimationFrame` — so originals inserted later are never painted.
- **Editable fields** (`input`, `textarea`, `[contenteditable]`): if the
  value/text contains a sensitive span, add a class that applies
  `filter: blur(6px)` (stylesheet injected while active). Re-check on
  `input` events (fire before paint).
- **Stop** (guard inactive): disconnect observer, remove stylesheet/classes,
  and for each tracked node whose `nodeValue === applied`, set it back to
  `original` (nodes the page changed since are left alone).

### 4. Interaction with the AI-site restorer

On claude.ai / chatgpt.com / gemini.google.com the existing DOM restorer
turns stand-ins back into originals. While guarding, the restorer must be
disabled (its `getRestore` returns identity) and the guard swaps any
already-restored originals back to stand-ins; when guarding stops, the
restorer re-runs a full refresh. (Otherwise the two would fight.)

### 5. Engine addition

`findSensitive(text, detectors) → Array<{ start, end, category, style }>` —
detection + overlap resolution without touching the vault (pure;
`findRedactions` reimplemented on top of it).

### 6. Popup

"Screen guard" section: status (Active — sharing / Active — manual / Off) and
a manual on/off switch.

### Permissions

`content_scripts` gain `<all_urls>` entries (detector + guard; all frames).
The install prompt changes to "Read and change all your data on all
websites". No new API permissions besides `"commands"` manifest key (no
permission needed) and `chrome.storage.session` (covered by `"storage"`).

## Testing

- Unit: `findSensitive`; guard text processing as a pure function
  `guardText(text, detectors, lookup) → { text, pending: string[] }` (known
  → stand-in, unknown → mask + pending); registry reducer
  `(state, event) → state` (start/end/reset/tab removed/manual); restore
  logic on a fake node map.
- Live (Claude in Chrome): open a page with sensitive values; start a fake
  share by calling `getDisplayMedia` from a test page; confirm values swap,
  badge shows, stopping restores. Meet itself if the user wants to run a
  real call.

## Calls made (not discussed — correct if wrong)

- Mask character `•`, same length as the original, until a stand-in arrives.
- Blur radius 6px for sensitive editable fields.
- Keyboard shortcut `Alt+Shift+H`; action badge `SHARE`.
- Guard state in `chrome.storage.session` (cleared on browser restart).
- New values seen during a share are added to the global vault (consistent
  with "same fake everywhere").
- All frames guarded (`all_frames: true`).
