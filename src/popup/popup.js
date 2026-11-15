// Popup: settings, dictionary, vault viewer. Reads/writes chrome.storage.local
// directly; content scripts pick changes up via chrome.storage.onChanged.
import { Vault } from "../engine/vault.js";

const $ = (id) => document.getElementById(id);
let showOriginals = false;

async function load() {
  const { vault, dictionary = [], settings = {} } = await chrome.storage.local.get(["vault", "dictionary", "settings"]);
  return { vault, dictionary, settings: { enabled: true, ...settings } };
}

function mask(s) {
  return "•".repeat(Math.min(s.length, 12));
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const GUARD_LABELS = { share: "Active — sharing", manual: "Active — manual" };

async function renderGuard() {
  const { guard, manualGuard } = await chrome.storage.session.get(["guard", "manualGuard"]);
  $("guard-status").textContent = guard?.active ? GUARD_LABELS[guard.reason] : "Off";
  $("guard-manual").checked = Boolean(manualGuard);
}

$("guard-manual").addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "set-manual-guard", on: e.target.checked });
});

async function render() {
  renderGuard();
  const { vault, dictionary, settings } = await load();
  $("enabled").checked = settings.enabled;

  const list = $("dict-list");
  list.replaceChildren(
    ...(dictionary.length
      ? dictionary.map((entry, i) =>
          el("li", {}, [
            el("span", {}, [entry.term, " ", el("span", { className: "cat", textContent: entry.category })]),
            el("button", { className: "link danger", textContent: "Remove", onclick: () => removeTerm(i) }),
          ]),
        )
      : [el("li", { className: "empty", textContent: "No terms yet." })]),
  );

  const rows = Object.entries(vault?.byStandIn ?? {});
  $("vault-body").replaceChildren(
    ...(rows.length
      ? rows.map(([standIn, original]) =>
          el("tr", {}, [
            el("td", { textContent: standIn }),
            el("td", { textContent: showOriginals ? original : mask(original) }),
          ]),
        )
      : [el("tr", {}, [el("td", { className: "empty", textContent: "Nothing redacted yet." })])]),
  );
  $("toggle-originals").textContent = showOriginals ? "Hide originals" : "Show originals";
}

async function removeTerm(index) {
  const { dictionary } = await load();
  dictionary.splice(index, 1);
  await chrome.storage.local.set({ dictionary });
}

$("enabled").addEventListener("change", async (e) => {
  const { settings } = await load();
  await chrome.storage.local.set({ settings: { ...settings, enabled: e.target.checked } });
});

$("dict-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const term = $("term").value.trim();
  if (!term) return;
  const { dictionary } = await load();
  if (!dictionary.some((d) => d.term.toLowerCase() === term.toLowerCase())) {
    dictionary.push({ term, category: $("category").value });
    await chrome.storage.local.set({ dictionary });
  }
  $("term").value = "";
});

$("toggle-originals").addEventListener("click", () => {
  showOriginals = !showOriginals;
  render();
});

$("clear-vault").addEventListener("click", async () => {
  if (!confirm("Clear the vault? Stand-ins in existing chats will no longer be restored to their originals.")) return;
  // Keep counters so already-sent stand-ins are never reused for new data.
  const { vault } = await load();
  await chrome.storage.local.set({ vault: new Vault(vault).cleared().toJSON() });
});

chrome.storage.onChanged.addListener((_, area) => {
  if (area === "local") render();
  if (area === "session") renderGuard();
});

render();
