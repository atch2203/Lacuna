// Values the user added to the vault by hand (an API key, a password, an
// internal hostname…), so they're redacted before they're ever sent — even
// ones no pattern would detect. Pure.
import { PATTERN_DETECTORS } from "./patterns.js";
import { makeDictionaryDetectors } from "./dictionary.js";

// 2–3 capitalised words of letters: probably a person's name.
const NAME_LIKE = /^\p{Lu}[\p{Ll}'’-]+(?: \p{Lu}[\p{Ll}'’-]+){1,2}$/u;
const WORD_CATEGORIES = new Set(["PERSON", "ORG", "OTHER"]);

// Category of the pattern that matches the whole value, else SECRET (fake
// keeps the value's character classes).
export function classifyValue(value) {
  for (const d of PATTERN_DETECTORS) {
    if (d.find(value).some((s) => s.start === 0 && s.end === value.length)) return d.category;
  }
  if (NAME_LIKE.test(value)) return "PERSON";
  return "SECRET";
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One exact, case-sensitive detector per manual entry, not matching inside a
// longer word or number. state: Vault or its JSON (uses state.manual).
// Names, orgs and other terms behave like dictionary terms instead
// (case-insensitive, whole word, people's name parts).
export function manualDetectors(state) {
  const entries = Object.entries(state?.manual ?? {});
  const words = entries.filter(([, category]) => WORD_CATEGORIES.has(category));
  const exact = entries.filter(([, category]) => !WORD_CATEGORIES.has(category));
  return [...makeDictionaryDetectors(words.map(([term, category]) => ({ term, category }))), ...exact.map(([value, category]) => {
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`, "g");
    return {
      id: `manual:${value}`,
      category,
      style: "token",
      find(text) {
        return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
      },
    };
  })];
}
