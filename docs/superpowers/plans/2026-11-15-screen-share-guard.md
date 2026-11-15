# Screen-Share Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a `getDisplayMedia` share is active in any tab (or the manual switch is on), replace sensitive values on every page with vault stand-ins, and restore them when it ends.

**Architecture:** A MAIN-world detector on all sites wraps `getDisplayMedia` and reports share start/end through a postMessage hop to an ISOLATED guard script, which forwards to the service worker. The SW keeps a share registry in `chrome.storage.session` and publishes `guard.active`. Guard scripts in every frame react: they rewrite text nodes in place (known value → stand-in, unknown → `•` mask + `redact-spans` request), synchronously in a MutationObserver callback, blur sensitive editable fields, and restore originals on stop. The AI-site restorer pauses while guarding.

**Tech Stack:** Plain JS, esbuild, `node:test`, Chrome MV3 (`storage.session`, `commands`, `action` badge).

**Spec:** `docs/superpowers/specs/2026-11-15-screen-share-guard-design.md`

## Global Constraints

- Guard writes only `nodeValue` of existing text nodes — never adds/removes/splits nodes; never edits `input`/`textarea`/`[contenteditable]` content (blur them instead, `filter: blur(6px)`).
- Mask: `"•".repeat(original.length)`.
- MutationObserver work runs synchronously in the callback (no `requestAnimationFrame`) so originals are never painted.
- Guard state key `guard` = `{ active: boolean, reason: "share" | "manual" | null }` in `chrome.storage.session`; SW calls `chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })` on every startup.
- Registry persisted under `chrome.storage.session` key `shares`; manual switch under `manualGuard`.
- Keyboard command `toggle-screen-guard`, suggested key `Alt+Shift+H`; action badge text `SHARE` while active, cleared otherwise.
- Detector and guard scripts: `matches: ["<all_urls>"]`, `all_frames: true`, `match_origin_as_fallback: true`, `run_at: "document_start"`.
- Restore on stop only where `node.nodeValue === applied`.

## Review Focus

1. **Meet's "Stop presenting" calls `track.stop()` (no `ended` event)** → guard turns off. Test in Task 3.
2. **Meeting tab closed mid-share** → guard turns off. Test in Task 2.
3. **Value appears for the first time during a share** → masked in the same synchronous pass, never shown raw; swapped to its stand-in once assigned. Test in Task 1 + Task 4.
4. **Page re-renders a guarded node back to the original** → re-guarded in the observer callback. Test in Task 4.
5. **Guard stops after the page edited a guarded node** → page's newer text is not overwritten with the stale original. Test in Task 4.

---

## File Structure

```
src/engine/redact.js               + findSensitive
src/guard/guard-text.js            guardText (pure)
src/guard/share-registry.js        reduce / isActive (pure)
src/guard/share-detector.js        installShareDetector (MAIN, injectable)
src/guard/node-guard.js            createNodeGuard (WeakMap/Set bookkeeping; fake-node testable)
src/guard/screen-guard.js          DOM wiring: scan, observer, field blur, stylesheet
src/guard/main.js                  MAIN entry (all sites)
src/guard/content.js               ISOLATED entry (all sites)
src/background/index.js            + registry, session state, badge, command, tabs.onRemoved
src/content/index.js               restorer pauses while guard active
src/popup/popup.js, static/popup.html   + screen guard section
static/manifest.json, build.mjs
```

---

### Task 1: `findSensitive` + `guardText`

**Files:** Modify `src/engine/redact.js`; Create `src/guard/guard-text.js`. Test `tests/guard-text.test.js`.

**Interfaces — Produces:**
- `findSensitive(text, detectors) → Array<{ start, end, category, style }>` (non-overlapping, sorted; no vault access). `findRedactions` reimplemented on top of it.
- `guardText(text, detectors, lookup: (original) => string | undefined) → { text: string, pending: string[], changed: boolean }` — known → stand-in; unknown → `"•".repeat(len)` and original added to `pending` (deduped).

- [ ] **Step 1: Failing tests:** `findSensitive("key AKIAIOSFODNN7EXAMPLE")` → `[{start:4,end:24,category:"API_KEY",style:"token"}]`; `guardText` with lookup knowing the key → `"key [API_KEY_1]"`, `pending []`, `changed true`; unknown key → `"key " + "•".repeat(20)`, `pending ["AKIAIOSFODNN7EXAMPLE"]`; same unknown twice → `pending` has it once; clean text → unchanged, `changed false`; existing `findRedactions` tests still pass.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(guard): findSensitive and guardText`.

---

### Task 2: Share registry + service worker

**Files:** Create `src/guard/share-registry.js`; Modify `src/background/index.js`. Test `tests/share-registry.test.js`.

**Interfaces — Produces:**
- `State = { shares: { [key: string]: surface }, manual: boolean }`; `initialState()`.
- `reduce(state, event) → State` — events: `{type:"share-started", tabId, shareId, surface}`, `{type:"share-ended", tabId, shareId}`, `{type:"share-reset", tabId}` (drop all of that tab), `{type:"tab-removed", tabId}` (same), `{type:"manual", on}`. Key `"<tabId>:<shareId>"`. Pure, returns new objects.
- `guardOf(state) → { active, reason }` — `share` wins over `manual` for `reason`.
- SW messages (from content scripts; `tabId` = `sender.tab.id`): `share-started`, `share-ended`, `share-reset`; from popup: `{type:"set-manual-guard", on}`. Command `toggle-screen-guard` flips manual. `chrome.tabs.onRemoved` → `tab-removed`. After every event: persist `shares`/`manualGuard`, write `guard`, set badge. All registry updates go through `serialize` (one queue).

- [ ] **Step 1: Failing tests:** start → active, reason `share`; start then end → inactive; two shares, one ends → still active; start in tab 5 then `tab-removed` 5 → inactive; `share-reset` 5 drops only tab 5; manual on with no shares → reason `manual`; manual on + share → reason `share`; ending an unknown share is a no-op; reduce does not mutate its input.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement reducer; wire SW (load state from `storage.session` at startup, `setAccessLevel`).
- [ ] **Step 4:** `npm test` → PASS; `npm run build` clean.
- [ ] **Step 5:** Commit `feat(guard): share registry in the service worker`.

---

### Task 3: Share detector (MAIN world)

**Files:** Create `src/guard/share-detector.js`. Test `tests/share-detector.test.js`.

**Interfaces — Produces:**
- `installShareDetector({ mediaDevices, trackProto, report, newId = randomId })` — wraps `mediaDevices.getDisplayMedia`; for each returned video track: `report({type:"share-started", shareId, surface: track.getSettings?.().displaySurface ?? "unknown"})`; reports `share-ended` once per share on the track's `ended` event **or** a call to `trackProto.stop` on that track (wrapped; original `stop` still called). Rejections pass through untouched, no report.

- [ ] **Step 1: Failing tests** (fake `mediaDevices` returning a fake stream whose tracks are `EventTarget`s with `kind:"video"`, `getSettings()`, and prototype `stop`): start reported with surface `window`; `track.dispatchEvent(new Event("ended"))` → one `share-ended`; `track.stop()` → one `share-ended` and original stop called; `ended` after `stop` → still only one `share-ended`; rejected `getDisplayMedia` → rejects, nothing reported; audio tracks ignored.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(guard): getDisplayMedia share detector`.

---

### Task 4: Node guard (bookkeeping) + screen guard DOM wiring

**Files:** Create `src/guard/node-guard.js`, `src/guard/screen-guard.js`. Test `tests/node-guard.test.js`.

**Interfaces:**
- Consumes: `guardText` (Task 1).
- Produces:
  - `createNodeGuard({ transform: (text) => {text, pending, changed} }) → { process(node) → string[] /* pending */, reprocessAll() → string[], restoreAll() }` — `node` is anything with `nodeValue`. `process`: if node already tracked and `nodeValue === applied` → nothing; if tracked but `nodeValue` changed → treat new value as the new original; transform; if changed write `nodeValue` and track `{ original, applied }`. `reprocessAll` re-transforms every tracked node from its `original` (used after the vault gains stand-ins). `restoreAll`: write back `original` only where `nodeValue === applied`, then forget all.
  - `startScreenGuard({ getDetectors, lookup, requestStandIns: (originals) => void }) → { stop(), vaultChanged() }` — DOM wiring per spec §3 (TreeWalker scan; MutationObserver processed synchronously; skips `script/style/noscript`, editable regions, `[data-llm-redactor]`; editable fields blurred via injected `<style data-llm-redactor>` + `data-llm-redactor-blur` attribute, re-checked on `input`; pending batched with `queueMicrotask` into one `requestStandIns` call).

- [ ] **Step 1: Failing tests** (fake nodes `{ nodeValue }`, transform = `guardText` with a test lookup): known value replaced; unknown masked and returned as pending; Review Focus 4: page sets `nodeValue` back to the original → `process` re-guards it; Review Focus 5: page sets `nodeValue = "new text"` → `restoreAll` leaves `"new text"`; untouched guarded node restored to original; `reprocessAll` after lookup learns the stand-in turns `•••` into the stand-in (Review Focus 3); `process` on an already-guarded unchanged node does nothing (returns `[]`, no write).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement both files (`screen-guard.js` has no unit test — DOM; verified live in Task 5).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(guard): in-place text guard`.

---

### Task 5: Wiring, popup, manifest, live check

**Files:** Create `src/guard/main.js`, `src/guard/content.js`. Modify `src/content/index.js`, `src/popup/popup.js`, `static/popup.html`, `static/manifest.json`, `build.mjs`.

**Interfaces — Consumes:** Tasks 1–4; SW messages from Task 2.
- `src/guard/main.js`: `installShareDetector({ mediaDevices: navigator.mediaDevices, trackProto: MediaStreamTrack.prototype, report: (r) => window.postMessage({ source: "llm-redactor-share", ...r }, "*") })` (skip if `navigator.mediaDevices` missing).
- `src/guard/content.js`: forwards `llm-redactor-share` messages (`event.source === window`) to the SW; sends `share-reset` on `pagehide`; loads vault/dictionary from `storage.local`, watches `storage.local` + `storage.session` (`guard`); starts/stops `startScreenGuard`; `lookup = (o) => vault.byOriginal[o]`; `requestStandIns = (originals) => chrome.runtime.sendMessage({ type: "redact-spans", texts: originals })`; on vault change → `vaultChanged()`.
- `src/content/index.js`: restorer's `getRestore` returns identity while `guard.active`; full `refresh()` when it turns off.
- Popup: "Screen guard" section showing `Active — sharing` / `Active — manual` / `Off`, and a checkbox sending `set-manual-guard`.
- Manifest: two new `content_scripts` entries (Global Constraints), `commands.toggle-screen-guard` with `suggested_key.default "Alt+Shift+H"`; `host_permissions` unchanged.
- Build: entries `guard-main` and `guard-content` (IIFE).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npm run build`, `npm test` → clean, all PASS.
- [ ] **Step 3: Live check** (Claude in Chrome; user reloads extension): open a page with sensitive text (data URL not allowed for content scripts — use an `https://example.com` tab and inject text via JS, or a GitHub/Gist page); in another tab (`https://example.com`) call `navigator.mediaDevices.getDisplayMedia()` — **user must pick a surface in Chrome's picker** — expect: values swap to stand-ins in the first tab, badge `SHARE`; stop the track → originals return, badge cleared. Manual switch from popup → same. On claude.ai during a share: stand-ins shown, not originals.
- [ ] **Step 4:** Commit `feat(guard): wire screen-share guard`.
