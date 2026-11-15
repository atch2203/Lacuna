# Demo Notifications + Ghost Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In-page demo notices of what the extension substitutes, and a clipboard that receives real values when stand-ins are copied.

**Spec:** `docs/superpowers/specs/2026-11-15-demo-notifications-ghost-clipboard-design.md`

## Global Constraints
- Notices only when `settings.demoNotifications === true`; 6 s auto-dismiss; reply/guard counts aggregated over 1.5 s.
- While `guard.active`, notices never contain originals.
- Ghost clipboard only on the three AI hosts or while `guard.active`.

## Review Focus
1. Notice text while the guard is active contains no original value. Test in Task 1.
2. Copy of text with no stand-ins → clipboard untouched (no preventDefault). Test in Task 2.
3. Page set its own clipboard data in a copy handler → we restore that data, not the selection. Test in Task 2.
4. Paste of a real value into a textarea during a share → blurred. Test in Task 3.
5. Long originals in notices are truncated. Test in Task 1.

---

### Task 1: Notice text + wiring
**Files:** Create `src/demo/notices.js`; Modify `src/background/index.js` (`redact` returns `spans` too), `src/content/index.js`, `src/content/dom-restorer.js` (`onRestored(count)`), `src/content/file-interceptor.js` (file notice text), `src/content/badge.js` (multi-line style), `src/guard/content.js` + `src/guard/screen-guard.js` (`onGuarded(count)`), popup checkbox. Test `tests/notices.test.js`.
**Produces:**
- `sentNotice(host, swaps: Array<{original, standIn}>, { guardActive }) → string`
- `restoredNotice(n) → string`, `guardNotice({ active, reason, hidden }) → string`, `copiedNotice(n) → string`
- `createAggregator(flush: (total) => void, ms = 1500) → (n) => void`
- [ ] Failing tests: sent notice lists `jane@corp.io → jordan.lee@example.com`; with `guardActive` it lists only `→ jordan.lee@example.com` (category hidden original) and never contains `jane`; originals > 24 chars truncated with `…`; aggregator sums calls within the window and flushes once (use fake timers via injected `setTimer`).
- [ ] Implement + wire. `npm test`, `npm run build` clean. Commit `feat(demo): in-page demo notifications`.

### Task 2: Ghost clipboard
**Files:** Create `src/demo/clipboard.js`; Modify `src/guard/main.js` (wrap `navigator.clipboard.writeText`/`write`), `src/guard/content.js` (copy listener + `restore-clipboard` bridge responder). Test `tests/clipboard.test.js`.
**Produces:**
- `restoreClipboardText(text, entries: Array<[standIn, original]>) → { text, count }`
- `handleCopy(event, { getSelectionText, restore }) → number` (count; sets data + preventDefault only if changed)
- `wrapClipboard(clipboard, restoreAsync: (text) => Promise<string>)`
- [ ] Failing tests: restore counts; no stand-ins → event untouched; page-set data (fake `clipboardData` with existing `text/plain`) is restored instead of the selection; `writeText` wrapper passes restored text to the original; `write` wrapper restores `text/plain` and `text/html` blobs (fake ClipboardItem).
- [ ] Implement + wire (applicability decided in ISOLATED: AI host or guard active). Commit `feat(demo): ghost clipboard`.

### Task 3: Paste-during-share test
**Files:** Test `tests/screen-guard-dom.test.js`.
- [ ] Test: guard active, set a textarea's value to a real key as a paste would, dispatch `input` → textarea blurred. Commit `test(guard): paste during share is censored`.
