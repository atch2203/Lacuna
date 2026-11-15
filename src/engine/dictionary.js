// Tier 2: user dictionary detectors. Pure: no DOM, no chrome.*.

const FAKE_CATEGORIES = new Set(["PERSON", "ORG"]);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// entries: Array<{ term, category: "PERSON"|"ORG"|"OTHER" }>
export function makeDictionaryDetectors(entries) {
  return entries
    .filter((e) => e.term && e.term.trim())
    .map(({ term, category }) => {
      const t = term.trim();
      // Whole-word via lookarounds, so terms that start/end with punctuation
      // ("c++") still work, unlike \b.
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(t)}(?![\\p{L}\\p{N}_])`, "giu");
      return {
        id: `dict:${t}`,
        category,
        style: FAKE_CATEGORIES.has(category) ? "fake" : "token",
        find(text) {
          return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
        },
      };
    });
}
