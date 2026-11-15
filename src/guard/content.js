// ISOLATED-world entry (all sites, all frames): forwards share events to the
// service worker, and runs the screen guard while guard.active.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { startScreenGuard } from "./screen-guard.js";
import { guardNotice, copiedNotice } from "../demo/notices.js";
import { restoreClipboardText, handleCopy, performClipboardWrite } from "../demo/clipboard.js";
import { showInfoBadge, clearNotices } from "../content/badge.js";

const SOURCE = "llm-redactor-share";
const EMPTY = { byOriginal: {}, byStandIn: {} };

let vault = EMPTY; // persistent vault (read-only here)
let guardVault = EMPTY; // session-only stand-ins for values first seen during a share
let detectors = PATTERN_DETECTORS;
let enabled = true;
let active = false;
let reason = null;
let demo = false;
let guard = null;
// Stand-ins the guard wrote into THIS document (standIn → original). Off the
// AI sites, the ghost clipboard restores only these: values this page
// already showed, so a page can't plant "[API_KEY_1]" to fetch a real key.
const ownStandIns = new Map();

// Demo notices: top frame only; counts distinct values hidden in this page.
const isTop = window === window.top;
const hidden = new Set();
let hiddenTimer = null;
function noteHidden(original) {
  if (!demo || !isTop || hidden.has(original)) return;
  hidden.add(original);
  hiddenTimer ??= setTimeout(() => {
    hiddenTimer = null;
    if (guard) showInfoBadge(guardNotice({ active: true, reason, hidden: hidden.size }), { timeoutMs: 6000 });
  }, 1500);
}

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "guard-state") return;
  active = Boolean(msg.guard?.active);
  reason = msg.guard?.reason ?? null;
  apply();
});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (event.source !== window || msg?.source !== SOURCE) return;
  if (msg.type === "share-started" || msg.type === "share-ended") {
    send({ type: msg.type, shareId: msg.shareId, surface: msg.surface });
  }
});

// A frame going away ends the shares it started (the SW keys shares by frame).
let reportedShare = false;
window.addEventListener("message", (e) => {
  if (e.source === window && e.data?.source === SOURCE && e.data.type === "share-started") reportedShare = true;
});
window.addEventListener("pagehide", () => {
  if (reportedShare) send({ type: "share-reset" });
});

function start() {
  guard = startScreenGuard({
    getDetectors: () => detectors,
    lookup: (o) => {
      noteHidden(o);
      const standIn = vault.byOriginal?.[o] ?? guardVault.byOriginal?.[o];
      if (standIn !== undefined) ownStandIns.set(standIn, o);
      return standIn;
    },
    isStandIn: (s) => vault.byStandIn?.[s] !== undefined || guardVault.byStandIn?.[s] !== undefined,
    requestStandIns: (items) => send({ type: "guard-stand-ins", items }),
  });
}

// --- Canvas guard bridge (Google Docs/Sheets/Slides) ------------------------
const CANVAS = "llm-redactor-canvas";
const isDocs = location.hostname === "docs.google.com";
const canvasPending = new Set();
const toCanvas = (msg) => window.postMessage({ source: CANVAS, ...msg }, "*");
const standInOf = (o) => vault.byOriginal?.[o] ?? guardVault.byOriginal?.[o];

function answerCanvas(originals) {
  const map = {};
  for (const o of originals) {
    const s = standInOf(o);
    if (s !== undefined) {
      map[o] = s;
      canvasPending.delete(o);
    }
  }
  if (Object.keys(map).length) toCanvas({ type: "standins", map });
}

if (isDocs) {
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || msg?.source !== CANVAS || msg.type !== "request" || !(active && enabled)) return;
    const items = (Array.isArray(msg.items) ? msg.items : []).slice(0, 200).filter((i) => typeof i?.original === "string");
    for (const i of items) canvasPending.add(i.original);
    answerCanvas(items.map((i) => i.original));
    const unknown = items.filter((i) => canvasPending.has(i.original));
    if (unknown.length) send({ type: "guard-stand-ins", items: unknown });
  });
}

function apply({ restart = false } = {}) {
  const shouldRun = active && enabled;
  if (isDocs) toCanvas({ type: "state", active: shouldRun });
  if (guard && (!shouldRun || restart)) {
    guard.stop();
    guard = null;
    if (!shouldRun && demo && isTop) showInfoBadge(guardNotice({ active: false }), { timeoutMs: 6000 });
    if (!shouldRun) hidden.clear();
  }
  if (shouldRun && !guard) {
    clearNotices();
    start();
  }
}

function setDictionary(dictionary) {
  detectors = [...PATTERN_DETECTORS, ...makeDictionaryDetectors(dictionary ?? [])];
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    if (changes.guardVault) {
      guardVault = changes.guardVault.newValue ?? EMPTY;
      guard?.vaultChanged();
      if (isDocs && canvasPending.size) answerCanvas([...canvasPending]);
    }
    if (changes.guard) {
      active = Boolean(changes.guard.newValue?.active);
      reason = changes.guard.newValue?.reason ?? null;
      apply();
    }
    return;
  }
  if (area !== "local") return;
  if (changes.settings) {
    enabled = changes.settings.newValue?.enabled !== false;
    demo = changes.settings.newValue?.demoNotifications === true;
    apply();
  }
  if (changes.dictionary) {
    setDictionary(changes.dictionary.newValue);
    apply({ restart: true });
  }
  if (changes.vault) {
    vault = changes.vault.newValue ?? EMPTY;
    guard?.vaultChanged();
    if (isDocs && canvasPending.size) answerCanvas([...canvasPending]);
  }
});

// Ask for the guard state first and start masking with pattern detectors right
// away; once the vault and dictionary arrive, restart with full knowledge.
(async () => {
  const sessionP = chrome.storage.session.get(["guard", "guardVault"]).catch(() => ({}));
  const localP = chrome.storage.local.get(["vault", "dictionary", "settings"]);
  const session = await sessionP;
  active = Boolean(session.guard?.active);
  reason = session.guard?.reason ?? null;
  guardVault = session.guardVault ?? EMPTY;
  apply();
  const local = await localP;
  vault = local.vault ?? EMPTY;
  setDictionary(local.dictionary);
  enabled = local.settings?.enabled !== false;
  demo = local.settings?.demoNotifications === true;
  apply({ restart: Boolean(guard) });
})();

// --- Ghost clipboard ---------------------------------------------------------
// Real values go on the clipboard when copied text contains stand-ins, on the
// AI sites and on any page while the guard is active.
const CLIP = "llm-redactor-clip";
const AI_HOSTS = new Set(["claude.ai", "chatgpt.com", "gemini.google.com"]);
const clipboardApplies = () => enabled && (AI_HOSTS.has(location.hostname) || active);
const isAiHost = AI_HOSTS.has(location.hostname);
// On AI sites the page can already read originals (on-screen restore writes
// them into the DOM), so all stand-ins apply there; elsewhere only this page's.
const clipEntries = () =>
  isAiHost
    ? [...Object.entries(vault.byStandIn ?? {}), ...Object.entries(guardVault.byStandIn ?? {})]
    : [...ownStandIns];
const restoreClip = (text) => restoreClipboardText(text, clipEntries());

function noteCopied(count) {
  if (count && demo && isTop) showInfoBadge(copiedNotice(count), { timeoutMs: 6000 });
}

function selectionHtml() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  const div = document.createElement("div");
  for (let i = 0; i < sel.rangeCount; i++) div.append(sel.getRangeAt(i).cloneContents());
  return div.innerHTML;
}

// Run after the page's own copy handlers (so page-set data is honoured) and
// last (so no page listener can read the restored data): when a copy starts
// (window, capture), add a one-shot window bubble listener — it lands at the
// end of the list.
window.addEventListener(
  "copy",
  () => {
    if (!clipboardApplies()) return;
    window.addEventListener(
      "copy",
      (event) => {
        if (!clipboardApplies()) return;
        noteCopied(
          handleCopy(event, {
            getSelectionText: () => String(window.getSelection() ?? ""),
            getSelectionHtml: selectionHtml,
            restore: restoreClip,
          }),
        );
      },
      { once: true },
    );
  },
  true,
);

window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (event.source !== window || msg?.source !== CLIP || msg.type !== "write") return;
  let handled = 0;
  // Only right after a real user action (a site copy button), never on a
  // page's own initiative.
  if (clipboardApplies() && navigator.userActivation?.isActive) {
    try {
      handled = await performClipboardWrite(msg.request, { restore: restoreClip, clipboard: navigator.clipboard });
    } catch {
      handled = 0; // fall back to the page's own write
    }
  }
  noteCopied(handled);
  window.postMessage({ source: CLIP, type: "ack", id: msg.id, handled: handled > 0 }, "*");
});
