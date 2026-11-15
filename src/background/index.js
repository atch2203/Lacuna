// Service worker: the single writer of the vault. Every tab's redaction
// request is serialized here, so concurrent requests (same tab or across
// tabs) can't overwrite each other's new stand-ins.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { redact, findRedactions } from "../engine/redact.js";
import { serialize } from "../shared/serialize.js";
import { loadState, saveVault } from "../content/store.js";
import { initialState, reduce, guardOf } from "../guard/share-registry.js";

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

// --- Screen-share guard registry -------------------------------------------
// Content scripts read `guard` from storage.session; allow them to.
chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
// Wake at browser start so the access level is set before pages ask.
chrome.runtime.onStartup.addListener(() => {});

const updateGuard = serialize(async (event) => {
  const stored = await chrome.storage.session.get(["shares", "manualGuard"]);
  const before = { ...initialState(), shares: stored.shares ?? {}, manual: stored.manualGuard ?? false };
  const after = reduce(before, event);
  const guard = guardOf(after);
  await chrome.storage.session.set({ shares: after.shares, manualGuard: after.manual, guard });
  await chrome.action.setBadgeText({ text: guard.active ? "SHARE" : "" });
  if (guard.active) await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  return guard;
});

chrome.tabs.onRemoved.addListener((tabId) => updateGuard({ type: "tab-removed", tabId }));

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== "toggle-screen-guard") return;
  const { manualGuard } = await chrome.storage.session.get("manualGuard");
  await updateGuard({ type: "manual", on: !manualGuard });
});

const shareEvent = (type) => (msg, sender) =>
  sender.tab?.id === undefined
    ? Promise.resolve({ error: "no tab" })
    : updateGuard({ type, tabId: sender.tab.id, shareId: msg.shareId, surface: msg.surface }).then((guard) => ({ guard }));

const HANDLERS = {
  "share-started": shareEvent("share-started"),
  "share-ended": shareEvent("share-ended"),
  "share-reset": shareEvent("share-reset"),
  "set-manual-guard": (msg) => updateGuard({ type: "manual", on: msg.on }).then((guard) => ({ guard })),
  redact: (msg) => redactTexts(msg.texts).then((texts) => ({ texts })),
  "redact-spans": (msg) => redactSpans(msg.texts).then((spans) => ({ spans })),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, (err) => sendResponse({ error: String(err?.message ?? err) }));
  return true; // async response
});
