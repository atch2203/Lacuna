// Tier 2: user dictionary detectors. Pure: no DOM, no chrome.*.

const FAKE_CATEGORIES = new Set(["PERSON", "ORG"]);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWordDetector(id, phrase, category, extra = {}) {
  // Whole-word via lookarounds, so terms that start/end with punctuation
  // ("c++") still work, unlike \b.
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}_])`, "giu");
  return {
    id,
    category,
    style: FAKE_CATEGORIES.has(category) ? "fake" : "token",
    ...extra,
    find(text) {
      return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    },
  };
}

// entries: Array<{ term, category: "PERSON"|"ORG"|"OTHER" }>
// A multi-word PERSON also matches each of its name parts (2+ letters) on
// their own; such detectors carry { fullTerm, partIndex } so the part maps to
// the matching word of the full name's fake.
export function makeDictionaryDetectors(entries) {
  return entries
    .filter((e) => e.term && e.term.trim())
    .flatMap(({ term, category }) => {
      const t = term.trim().replace(/\s+/g, " ");
      const detectors = [wholeWordDetector(`dict:${t}`, t, category)];
      const parts = t.split(" ");
      if (category === "PERSON" && parts.length > 1) {
        parts.forEach((part, partIndex) => {
          if (part.length >= 2) {
            detectors.push(wholeWordDetector(`dict:${t}#${partIndex}`, part, category, { fullTerm: t, partIndex }));
          }
        });
      }
      return detectors;
    });
}
