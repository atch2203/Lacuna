// ISOLATED-world entry: relays redaction requests from the MAIN-world hooks
// to the service worker (sole vault writer) and restores stand-ins on the page.
import { makeRestorer } from "../engine/restore.js";
import { serveRedaction, onFailure } from "../shared/bridge.js";
import { loadState, onStateChange } from "./store.js";
import { startDomRestorer } from "./dom-restorer.js";
import { showWarningBadge, showInfoBadge, clearNotices } from "./badge.js";
import { startFileInterceptor } from "./file-interceptor.js";
import { redactInFrame } from "./docframe-client.js";
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

onFailure(window, (reason) => {
  showWarningBadge(`Redaction failed — message sent unredacted: ${reason}`);
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

restorer = startDomRestorer({ getRestore: () => (guardActive || !guardKnown ? identity : restoreAndCount) });

startFileInterceptor({
  processFile: redactInFrame,
  isEnabled: () => enabled,
  notify: {
    working: (message) => showInfoBadge(message, { timeoutMs: 0 }),
    warn: (message) => showWarningBadge(message),
  },
});
