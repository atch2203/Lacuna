// ISOLATED-world entry: relays redaction requests from the MAIN-world hooks
// to the service worker (sole vault writer) and restores stand-ins on the page.
import { makeRestorer } from "../engine/restore.js";
import { serveRedaction } from "../shared/bridge.js";
import { loadState, onStateChange } from "./store.js";
import { startDomRestorer } from "./dom-restorer.js";
import { showInfoBadge, clearNotices } from "./badge.js";
import { startFileInterceptor } from "./file-interceptor.js";
import { redactInFrame, restoreInFrame } from "./docframe-client.js";
import { sentNotice, restoredNotice, fileNotice } from "../demo/notices.js";

let restore = makeRestorer([]);
let restorer = null;
let enabled = true;
let demo = false;
// While the screen guard is active (or not yet known), stand-ins stay on
// screen: don't restore.
let guardActive = false;
let guardKnown = false;
const identity = (text) => text;

function applyState(state) {
  enabled = state.settings.enabled;
  demo = state.settings.demoNotifications === true;
  restore = makeRestorer(state.vault.entries());
  restorer?.refresh();
}

loadState().then(applyState);
onStateChange(applyState);

serveRedaction(window, async (texts) => {
  const res = await chrome.runtime.sendMessage({ type: "redact", texts });
  if (!res || res.error) throw new Error(res?.error ?? "no response from service worker");
  if (demo && res.swaps?.length) {
    try {
      // Unknown guard state counts as active: never risk originals on a shared screen.
      showInfoBadge(sentNotice(location.host, res.swaps, { guardActive: guardActive || !guardKnown }), { timeoutMs: 6000 });
    } catch {
      // A notice must never turn a successful redaction into a failure.
    }
  }
  return res.texts;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.guard) return;
  const was = guardActive;
  guardActive = Boolean(changes.guard.newValue?.active);
  if (!was && guardActive) clearNotices();
  if (was && !guardActive) restorer?.refresh();
});
chrome.storage.session
  .get("guard")
  .then(({ guard }) => (guardActive = Boolean(guard?.active)))
  .catch(() => {})
  .finally(() => {
    guardKnown = true;
    if (!guardActive) restorer?.refresh();
  });

// Distinct stand-ins restored in the last 1.5 s → one "Restored N" notice.
const restoredRecently = new Set();
let restoredTimer = null;
function countRestored(text) {
  if (!demo) return;
  for (const s of restore.standInsIn(text)) restoredRecently.add(s);
  if (restoredRecently.size && !restoredTimer) {
    restoredTimer = setTimeout(() => {
      showInfoBadge(restoredNotice(restoredRecently.size), { timeoutMs: 6000 });
      restoredRecently.clear();
      restoredTimer = null;
    }, 1500);
  }
}

const restoreAndCount = (text) => {
  const out = restore(text);
  if (out !== text) countRestored(text);
  return out;
};

restorer = startDomRestorer({
  getRestore: () => (!enabled ? restore : guardActive || !guardKnown ? identity : restoreAndCount),
});

startFileInterceptor({
  processFile: redactInFrame,
  isEnabled: () => enabled,
  isGuardActive: () => guardActive || !guardKnown,
  notify: {
    working: (message) => {
      const update = showInfoBadge(message, { timeoutMs: 0 });
      return (kind, nextMessage, timeoutMs) =>
        update(kind === "warn" ? "silent" : kind, nextMessage, timeoutMs);
    },
    warn: () => {},
  },
});

// Generated files: the page script hands us file bytes to restore.
const FILE = "llm-redactor-file";
window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (event.source !== window || msg?.source !== FILE) return;
  if (msg.type === "picker-redact") {
    try {
      if (!enabled) {
        window.postMessage({ source: FILE, type: "picker-result", id: msg.id, status: "clean" }, "*");
        return;
      }
      const file = new File([msg.buffer], msg.name, { type: msg.mime, lastModified: msg.lastModified });
      const out = await redactInFrame(file);
      if (out.status !== "redacted") {
        window.postMessage({ source: FILE, type: "picker-result", id: msg.id, status: out.status }, "*");
        return;
      }
      const buffer = await out.file.arrayBuffer();
      window.postMessage({ source: FILE, type: "picker-result", id: msg.id, status: "redacted", buffer }, "*", [buffer]);
    } catch (err) {
      window.postMessage({ source: FILE, type: "picker-result", id: msg.id, status: "error", error: String(err?.message ?? err) }, "*");
    }
    return;
  }
  if (msg.type !== "restore") return;
  let bytes = null;
  if (!guardActive) {
    try {
      bytes = await restoreInFrame({ name: msg.name, mime: msg.mime, buffer: msg.buffer });
    } catch {
      bytes = null; // fail open: the site shows the file as generated
    }
  }
  const buffer = bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : null;
  window.postMessage({ source: FILE, type: "restored", id: msg.id, buffer }, "*", buffer ? [buffer] : []);
});
