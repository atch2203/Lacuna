// ISOLATED-world entry: owns the vault, serves redaction requests from the
// MAIN-world fetch hook, restores stand-ins on the page.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { redact } from "../engine/redact.js";
import { makeRestorer } from "../engine/restore.js";
import { Vault } from "../engine/vault.js";
import { serveRedaction, onFailure } from "../shared/bridge.js";
import { loadState, saveVault, onStateChange } from "./store.js";
import { startDomRestorer } from "./dom-restorer.js";
import { showWarningBadge } from "./badge.js";

let state = { vault: new Vault(), dictionary: [], settings: { enabled: true } };
let restore = makeRestorer([]);
let restorer = null;

function applyState(next) {
  state = next;
  restore = makeRestorer(state.vault.entries());
  restorer?.refresh();
}

const ready = loadState().then(applyState);

serveRedaction(window, async (texts) => {
  await ready;
  // Re-read before writing so a vault another tab just saved isn't clobbered.
  const fresh = await loadState();
  if (!fresh.settings.enabled) return texts;
  const detectors = [...PATTERN_DETECTORS, ...makeDictionaryDetectors(fresh.dictionary)];
  const before = fresh.vault.entries().length;
  const out = texts.map((t) => redact(t, detectors, fresh.vault));
  if (fresh.vault.entries().length !== before) {
    await saveVault(fresh.vault);
  }
  applyState(fresh);
  return out;
});

onFailure(window, (reason) => {
  showWarningBadge(`Redaction failed — message sent unredacted: ${reason}`);
});

onStateChange(applyState);

restorer = startDomRestorer({ getRestore: () => restore });
