// ISOLATED-world entry (all sites, all frames): forwards share events to the
// service worker, and runs the screen guard while guard.active.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { startScreenGuard } from "./screen-guard.js";

const SOURCE = "llm-redactor-share";

let vault = { byOriginal: {} };
let detectors = PATTERN_DETECTORS;
let enabled = true;
let active = false;
let guard = null;

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (event.source !== window || msg?.source !== SOURCE) return;
  if (msg.type === "share-started" || msg.type === "share-ended") {
    send({ type: msg.type, shareId: msg.shareId, surface: msg.surface });
  }
});

// Leaving the meeting page ends its shares. Only the top frame resets, since
// the registry tracks shares per tab.
window.addEventListener("pagehide", () => {
  if (window === window.top) send({ type: "share-reset" });
});

function start() {
  guard = startScreenGuard({
    getDetectors: () => detectors,
    lookup: (original) => vault.byOriginal?.[original],
    requestStandIns: (originals) => send({ type: "redact-spans", texts: originals }),
  });
}

function apply({ restart = false } = {}) {
  const shouldRun = active && enabled;
  if (guard && (!shouldRun || restart)) {
    guard.stop();
    guard = null;
  }
  if (shouldRun && !guard) start();
}

function setDictionary(dictionary) {
  detectors = [...PATTERN_DETECTORS, ...makeDictionaryDetectors(dictionary ?? [])];
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.guard) {
    active = Boolean(changes.guard.newValue?.active);
    apply();
  }
  if (area !== "local") return;
  if (changes.settings) {
    enabled = changes.settings.newValue?.enabled !== false;
    apply();
  }
  if (changes.dictionary) {
    setDictionary(changes.dictionary.newValue);
    apply({ restart: true });
  }
  if (changes.vault) {
    vault = changes.vault.newValue ?? { byOriginal: {} };
    guard?.vaultChanged();
  }
});

(async () => {
  const local = await chrome.storage.local.get(["vault", "dictionary", "settings"]);
  vault = local.vault ?? { byOriginal: {} };
  setDictionary(local.dictionary);
  enabled = local.settings?.enabled !== false;
  try {
    const { guard: state } = await chrome.storage.session.get("guard");
    active = Boolean(state?.active);
  } catch {
    // storage.session not yet opened to content scripts (SW hasn't run since
    // browser start); the onChanged listener picks up the first activation.
    active = false;
  }
  apply();
})();
