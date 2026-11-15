// Service worker: the single writer of the vault. Every tab's redaction
// request is serialized here, so concurrent requests (same tab or across
// tabs) can't overwrite each other's new stand-ins.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { redact, findRedactions } from "../engine/redact.js";
import { serialize } from "../shared/serialize.js";
import { loadState, saveVault } from "../content/store.js";

// Both message types share one queue so vault writes never interleave.
// fn(texts, detectors, vault) → result; `disabled(texts)` is returned when off.
const withVault = serialize(async (texts, fn, disabled) => {
  const { vault, dictionary, settings } = await loadState();
  if (!settings.enabled) return disabled(texts);
  const detectors = [...PATTERN_DETECTORS, ...makeDictionaryDetectors(dictionary)];
  const before = vault.entries().length;
  const out = texts.map((t) => fn(t, detectors, vault));
  if (vault.entries().length !== before) await saveVault(vault);
  return out;
});

const redactTexts = (texts) => withVault(texts, redact, (t) => t);
const redactSpans = (texts) => withVault(texts, findRedactions, (t) => t.map(() => []));

const HANDLERS = {
  redact: (msg) => redactTexts(msg.texts).then((texts) => ({ texts })),
  "redact-spans": (msg) => redactSpans(msg.texts).then((spans) => ({ spans })),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg).then(sendResponse, (err) => sendResponse({ error: String(err?.message ?? err) }));
  return true; // async response
});
