// ISOLATED-world entry: relays redaction requests from the MAIN-world hooks
// to the service worker (sole vault writer) and restores stand-ins on the page.
import { makeRestorer } from "../engine/restore.js";
import { serveRedaction, onFailure } from "../shared/bridge.js";
import { loadState, onStateChange } from "./store.js";
import { startDomRestorer } from "./dom-restorer.js";
import { showWarningBadge, showInfoBadge } from "./badge.js";
import { startFileInterceptor } from "./file-interceptor.js";
import { redactInFrame } from "./docframe-client.js";

let restore = makeRestorer([]);
let restorer = null;
let enabled = true;

function applyState(state) {
  enabled = state.settings.enabled;
  restore = makeRestorer(state.vault.entries());
  restorer?.refresh();
}

loadState().then(applyState);
onStateChange(applyState);

serveRedaction(window, async (texts) => {
  const res = await chrome.runtime.sendMessage({ type: "redact", texts });
  if (!res || res.error) throw new Error(res?.error ?? "no response from service worker");
  return res.texts;
});

onFailure(window, (reason) => {
  showWarningBadge(`Redaction failed — message sent unredacted: ${reason}`);
});

restorer = startDomRestorer({ getRestore: () => restore });

startFileInterceptor({
  processFile: redactInFrame,
  isEnabled: () => enabled,
  notify: {
    working: (message) => showInfoBadge(message, { timeoutMs: 0 }),
    warn: (message) => showWarningBadge(message),
  },
});
