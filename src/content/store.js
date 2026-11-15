// chrome.storage.local wrapper. Keys: vault, dictionary, settings.
import { Vault } from "../engine/vault.js";

const DEFAULT_SETTINGS = { enabled: true };

function toState(raw) {
  return {
    vault: new Vault(raw.vault),
    dictionary: raw.dictionary ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

export async function loadState() {
  return toState(await chrome.storage.local.get(["vault", "dictionary", "settings"]));
}

export async function saveVault(vault) {
  await chrome.storage.local.set({ vault: vault.toJSON() });
}

// cb receives the full, freshly loaded state after any relevant change.
export function onStateChange(cb) {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (!("vault" in changes || "dictionary" in changes || "settings" in changes)) return;
    cb(await loadState());
  });
}
