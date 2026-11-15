// Service worker: the single writer of the vault. Every tab's redaction
// request is serialized here, so concurrent requests (same tab or across
// tabs) can't overwrite each other's new stand-ins.
import { PATTERN_DETECTORS } from "../engine/patterns.js";
import { makeDictionaryDetectors } from "../engine/dictionary.js";
import { findRedactions } from "../engine/redact.js";
import { serialize } from "../shared/serialize.js";
import { loadState, saveVault } from "../content/store.js";
import { initialState, reduce, guardOf } from "../guard/share-registry.js";
import { assignGuardStandIns } from "../guard/guard-vault.js";
import { restoreSpansFor } from "../docs/restore-spans.js";
import { activeEntries } from "../engine/vault.js";

// Every vault read-modify-write runs on one queue so writes never interleave.
const vaultQueue = serialize(async (task) => task());

// fn(texts, detectors, vault) → result; `disabled(texts)` is returned when off.
const withVault = (texts, fn, disabled) =>
  vaultQueue(async () => {
    const { vault, dictionary, settings } = await loadState();
    if (!settings.enabled) return disabled(texts);
    const detectors = [...PATTERN_DETECTORS, ...makeDictionaryDetectors(dictionary)];
    const before = JSON.stringify(vault.byOriginal);
    const out = texts.map((t) => fn(t, detectors, vault));
    if (JSON.stringify(vault.byOriginal) !== before) await saveVault(vault);
    return out;
  });

// Popup edits (per-item enable/disable, remove), on the same queue.
const editVault = (mutate) =>
  vaultQueue(async () => {
    const { vault } = await loadState();
    mutate(vault);
    await saveVault(vault);
    return {};
  });

// Redacted text plus the swaps made (for demo notices).
function redactWithSwaps(text, detectors, vault) {
  const spans = findRedactions(text, detectors, vault);
  const swaps = spans.map(({ start, end, standIn }) => ({ original: text.slice(start, end), standIn }));
  let out = "";
  let cursor = 0;
  for (const { start, end, standIn } of spans) {
    out += text.slice(cursor, start) + standIn;
    cursor = end;
  }
  return { text: out + text.slice(cursor), swaps };
}

const redactTexts = (texts) => withVault(texts, redactWithSwaps, (t) => t.map((text) => ({ text, swaps: [] })));
const redactSpans = (texts) => withVault(texts, findRedactions, (t) => t.map(() => []));

async function recordDemoSwaps(swaps, sender) {
  if (!swaps.length) return;
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (settings.demoNotifications !== true) return;
  const host = (() => {
    try {
      return new URL(sender?.tab?.url ?? "").host || "unknown site";
    } catch {
      return "unknown site";
    }
  })();
  const { demoSwaps = [] } = await chrome.storage.session.get("demoSwaps");
  const entries = swaps.map(({ original, standIn }) => ({ original, standIn, host, time: Date.now() }));
  await chrome.storage.session.set({ demoSwaps: [...entries, ...demoSwaps].slice(0, 100) });
}

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
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter(({ id }) => id !== undefined)
      .map(({ id }) => chrome.tabs.sendMessage(id, { type: "guard-state", guard }).catch(() => {})),
  );
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
    : updateGuard({ type, tabId: sender.tab.id, frameId: sender.frameId ?? 0, shareId: msg.shareId, surface: msg.surface }).then(
        (guard) => ({ guard }),
      );

// Stand-ins for values first seen during a share: session-only, capped map.
const assignGuard = serialize(async (items) => {
  const [{ guardVault }, { vault }] = await Promise.all([
    chrome.storage.session.get("guardVault"),
    chrome.storage.local.get("vault"),
  ]);
  const next = assignGuardStandIns(guardVault, vault, Array.isArray(items) ? items.slice(0, 200) : []);
  await chrome.storage.session.set({ guardVault: next });
  return {};
});

const HANDLERS = {
  "share-started": shareEvent("share-started"),
  "share-ended": shareEvent("share-ended"),
  "share-reset": shareEvent("share-reset"),
  "guard-stand-ins": (msg) => assignGuard(msg.items),
  "restore-spans": async (msg) => {
    const [{ vault }, { guardVault }] = await Promise.all([
      chrome.storage.local.get("vault"),
      chrome.storage.session.get("guardVault"),
    ]);
    const entries = [...activeEntries(vault), ...activeEntries(guardVault)];
    return { spans: restoreSpansFor(msg.texts ?? [], entries) };
  },
  "vault-set-enabled": (msg) => editVault((v) => v.setEnabled(String(msg.original), Boolean(msg.enabled))),
  "vault-remove": (msg) => editVault((v) => v.remove(String(msg.original))),
  "set-manual-guard": (msg) => updateGuard({ type: "manual", on: msg.on }).then((guard) => ({ guard })),
  redact: (msg, sender) =>
    redactTexts(msg.texts).then(async (out) => {
      const swaps = out.flatMap((o) => o.swaps);
      await recordDemoSwaps(swaps, sender);
      return { texts: out.map((o) => o.text), swaps };
    }),
  "redact-spans": (msg) => redactSpans(msg.texts).then((spans) => ({ spans })),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, (err) => sendResponse({ error: String(err?.message ?? err) }));
  return true; // async response
});
