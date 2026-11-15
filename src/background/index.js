// Service worker: the single writer of the vault. Every tab's redaction
// request is serialized here, so concurrent requests (same tab or across
// tabs) can't overwrite each other's new stand-ins.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { redact } from "../engine/redact.js";
import { serialize } from "../shared/serialize.js";
import { loadState, saveVault } from "../content/store.js";

const redactTexts = serialize(async (texts) => {
  const { vault, dictionary, settings } = await loadState();
  if (!settings.enabled) return texts;
  const detectors = [...PATTERN_DETECTORS, ...makeDictionaryDetectors(dictionary)];
  const before = vault.entries().length;
  const out = texts.map((t) => redact(t, detectors, vault));
  if (vault.entries().length !== before) await saveVault(vault);
  return out;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "redact") return false;
  redactTexts(msg.texts).then(
    (texts) => sendResponse({ texts }),
    (err) => sendResponse({ error: String(err?.message ?? err) }),
  );
  return true; // async response
});
