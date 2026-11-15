# Demo Notifications + Ghost Clipboard — Design (short)

Date: 2026-11-15
Status: Approved

## Intent
Hackathon demo polish: (1) show, in-page, what the extension substitutes and
when; (2) when the user copies text containing stand-ins, put the real values
on the clipboard.

## 1. Demo notifications
- In-page notices (same shadow-root stack as the existing warning), dark info
  style, multi-line, auto-dismiss after 6 s. Enabled by a popup checkbox
  "Demo notifications" (`settings.demoNotifications`, default off).
- Events:
  - Prompt sent: `↑ Sent to <host> — N swaps` + one line per swap
    `<original> → <stand-in>` (originals truncated to 24 chars).
  - Reply restored: `↓ Restored N values` — counted from the DOM restorer,
    aggregated over 1.5 s.
  - File redacted: `📄 <name> — N swaps`.
  - Screen guard on: `🛡 Screen guard ON (<reason>) — N values hidden`
    (aggregated over 1.5 s); off: `🛡 Screen guard OFF`.
  - Copy with real values: `📋 Copied with N real values`.
- **Safety rule:** while the screen guard is active, notices never show
  originals — only stand-ins and categories.

## 2. Ghost clipboard
- Copy shortcut / menu (`copy` event, window bubble phase so page handlers run
  first): take the page-set `text/plain` if the page handled the event,
  otherwise the selection text; restore stand-ins to originals; if anything
  changed, write `text/plain` and prevent default.
- Site copy buttons: MAIN world wraps `navigator.clipboard.writeText` and
  `navigator.clipboard.write` (`text/plain` and `text/html` items); the text is
  restored via the bridge before the real call.
- Applies only on claude.ai / chatgpt.com / gemini.google.com, and on any page
  while the screen guard is active. Elsewhere text is returned unchanged.
- Restoration map = persistent vault + session guard map.

## Paste during a share
Unchanged guard behaviour: pasted text in editable fields is blurred; pasted
text rendered as page text is guarded. Pinned by a test.

## Approaches
Side-panel feed (rejected by user in favour of in-page notices, which are
visible on a shared screen).
