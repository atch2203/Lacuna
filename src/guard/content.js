// ISOLATED-world entry (all sites, all frames): forwards share events to the
// service worker, and runs the screen guard while guard.active.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { startScreenGuard } from "./screen-guard.js";

const SOURCE = "llm-redactor-share";
const EMPTY = { byOriginal: {}, byStandIn: {} };

let vault = EMPTY; // persistent vault (read-only here)
let guardVault = EMPTY; // session-only stand-ins for values first seen during a share
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
    lookup: (o) => vault.byOriginal?.[o] ?? guardVault.byOriginal?.[o],
    isStandIn: (s) => vault.byStandIn?.[s] !== undefined || guardVault.byStandIn?.[s] !== undefined,
    requestStandIns: (items) => send({ type: "guard-stand-ins", items }),
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
  if (area === "session") {
    if (changes.guardVault) {
      guardVault = changes.guardVault.newValue ?? EMPTY;
      guard?.vaultChanged();
    }
    if (changes.guard) {
      active = Boolean(changes.guard.newValue?.active);
      apply();
    }
    return;
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
  guardVault = session.guardVault ?? EMPTY;
  apply();
  const local = await localP;
  vault = local.vault ?? EMPTY;
  setDictionary(local.dictionary);
  enabled = local.settings?.enabled !== false;
  apply({ restart: Boolean(guard) });
})();
