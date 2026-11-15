// Values the user added to the vault by hand (an API key, a password, an
// internal hostname…), so they're redacted before they're ever sent — even
// ones no pattern would detect. Pure.
import { PATTERN_DETECTORS } from "./patterns.js";

// Category of the pattern that matches the whole value, else SECRET (fake
// keeps the value's character classes).
export function classifyValue(value) {
  for (const d of PATTERN_DETECTORS) {
    if (d.find(value).some((s) => s.start === 0 && s.end === value.length)) return d.category;
  }
  return "SECRET";
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One exact, case-sensitive detector per manual entry, not matching inside a
// longer word or number. state: Vault or its JSON (uses state.manual).
export function manualDetectors(state) {
  return Object.entries(state?.manual ?? {}).map(([value, category]) => {
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`, "g");
    return {
      id: `manual:${value}`,
      category,
      style: "token",
      find(text) {
        return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
      },
    };
  });
}
