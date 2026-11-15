// ISOLATED-world entry (all sites, all frames): forwards share events to the
// service worker, and runs the screen guard while guard.active.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { startScreenGuard } from "./screen-guard.js";
import { guardNotice, copiedNotice } from "../demo/notices.js";
import { restoreClipboardText, handleCopy, performClipboardWrite } from "../demo/clipboard.js";
import { showInfoBadge } from "../content/badge.js";

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
      return vault.byOriginal?.[o] ?? guardVault.byOriginal?.[o];
    },
    isStandIn: (s) => vault.byStandIn?.[s] !== undefined || guardVault.byStandIn?.[s] !== undefined,
    requestStandIns: (items) => send({ type: "guard-stand-ins", items }),
  });
}

function apply({ restart = false } = {}) {
  const shouldRun = active && enabled;
  if (guard && (!shouldRun || restart)) {
    guard.stop();
    guard = null;
    if (!shouldRun && demo && isTop) showInfoBadge(guardNotice({ active: false }), { timeoutMs: 6000 });
    if (!shouldRun) hidden.clear();
  }
  if (shouldRun && !guard) start();
}

function setDictionary(dictionary) {
  detectors = [...PATTERN_DETECTORS, ...makeDictionaryDetectors(dictionary ?? [])];
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    if (changes.guardVault) {
      guardVault = changes.guardVault.newValue ?? EMPTY;
      guard?.vaultChanged();
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
const clipEntries = () => [...Object.entries(vault.byStandIn ?? {}), ...Object.entries(guardVault.byStandIn ?? {})];
const restoreClip = (text) => restoreClipboardText(text, clipEntries());

function noteCopied(count) {
  if (count && demo && isTop) showInfoBadge(copiedNotice(count), { timeoutMs: 6000 });
}

window.addEventListener("copy", (event) => {
  if (!clipboardApplies()) return;
  noteCopied(handleCopy(event, { getSelectionText: () => String(window.getSelection() ?? ""), restore: restoreClip }));
});

window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (event.source !== window || msg?.source !== CLIP || msg.type !== "write") return;
  let handled = 0;
  if (clipboardApplies()) {
    try {
      handled = await performClipboardWrite(msg.request, { restore: restoreClip, clipboard: navigator.clipboard });
    } catch {
      handled = 0; // fall back to the page's own write
    }
  }
  noteCopied(handled);
  window.postMessage({ source: CLIP, type: "ack", id: msg.id, handled: handled > 0 }, "*");
});
