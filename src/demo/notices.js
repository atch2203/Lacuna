// Text of the in-page demo notices. Pure.
// Rule: while the screen guard is active, never include originals.

const MAX_ORIGINAL = 24;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const truncate = (s) => (s.length > MAX_ORIGINAL ? `${s.slice(0, MAX_ORIGINAL - 1)}…` : s);

export function sentNotice(host, swaps, { guardActive }) {
  const lines = swaps.map(({ original, standIn }) => (guardActive ? `→ ${standIn}` : `${truncate(original)} → ${standIn}`));
  return [`↑ Sent to ${host} — ${plural(swaps.length, "swap")}`, ...lines].join("\n");
}

export const restoredNotice = (n) => `↓ Restored ${plural(n, "value")} in reply`;
export const copiedNotice = (n) => `📋 Copied with ${plural(n, "real value")}`;
export function fileNotice(name, swaps, { guardActive = false } = {}) {
  const entries = Array.isArray(swaps) ? swaps : [];
  const lines = entries.map(({ original, standIn }) => (guardActive ? `→ ${standIn}` : `${original} → ${standIn}`));
  return [`📄 ${name} — ${plural(entries.length, "swap")}`, ...lines].join("\n");
}

const REASONS = { share: "sharing", manual: "manual" };
export function guardNotice({ active, reason, hidden = 0 }) {
  return active ? `🛡 Screen guard ON (${REASONS[reason] ?? reason}) — ${plural(hidden, "value")} hidden` : "🛡 Screen guard OFF";
}

// Sums counts reported within `ms` and flushes once. setTimer is injectable for tests.
export function createAggregator(flush, ms = 1500, setTimer = (fn, t) => setTimeout(fn, t)) {
  let total = 0;
  let pending = false;
  return (n) => {
    if (!n) return;
    total += n;
    if (pending) return;
    pending = true;
    setTimer(() => {
      pending = false;
      const t = total;
      total = 0;
      flush(t);
    }, ms);
  };
}
