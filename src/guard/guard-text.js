// Screen-guard text transform: known sensitive values become their vault
// stand-ins; values without one yet become a same-length mask and are
// reported so a stand-in can be requested. Pure.
import { findSensitive } from "../engine/redact.js";

export function guardText(text, detectors, lookup) {
  const spans = findSensitive(text, detectors);
  if (spans.length === 0) return { text, pending: [], changed: false };
  const pending = new Set();
  const parts = [];
  let cursor = 0;
  for (const { start, end } of spans) {
    const original = text.slice(start, end);
    const standIn = lookup(original);
    if (standIn === undefined) pending.add(original);
    parts.push(text.slice(cursor, start), standIn ?? "•".repeat(original.length));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  const out = parts.join("");
  return { text: out, pending: [...pending], changed: out !== text };
}
