// Screen-guard text transform: known sensitive values become their stand-ins;
// values without one yet become a same-length mask and are reported (with
// category/style) so a stand-in can be requested. Text that already is a
// stand-in is left alone. Pure.
import { findSensitive } from "../engine/redact.js";

export function guardText(text, detectors, lookup, isStandIn = () => false) {
  const spans = findSensitive(text, detectors);
  const pending = new Map();
  const parts = [];
  let cursor = 0;
  for (const { start, end, category, style } of spans) {
    const original = text.slice(start, end);
    if (isStandIn(original)) continue;
    const standIn = lookup(original);
    if (standIn === undefined && !pending.has(original)) pending.set(original, { original, category, style });
    parts.push(text.slice(cursor, start), standIn ?? "•".repeat(original.length));
    cursor = end;
  }
  if (parts.length === 0) return { text, pending: [], changed: false };
  parts.push(text.slice(cursor));
  const out = parts.join("");
  return { text: out, pending: [...pending.values()], changed: out !== text };
}
