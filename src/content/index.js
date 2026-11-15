// ISOLATED-world entry: relays redaction requests from the MAIN-world hooks
// to the service worker (sole vault writer) and restores stand-ins on the page.
import { makeRestorer } from "../engine/restore.js";
import { serveRedaction, onFailure } from "../shared/bridge.js";
import { loadState, onStateChange } from "./store.js";
import { startDomRestorer } from "./dom-restorer.js";
import { showWarningBadge } from "./badge.js";

let restore = makeRestorer([]);
let restorer = null;

function applyState(state) {
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
