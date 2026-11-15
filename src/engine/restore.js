// Stand-in → original string replacer. Pure.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// entries: Array<[standIn, original]>
export function makeRestorer(entries) {
  if (entries.length === 0) return Object.assign((text) => text, { standInsIn: () => [] });
  const map = new Map(entries);
  // Longest first so "[CARD_10]" wins over its prefix "[CARD_1]".
  const alternation = [...map.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const re = new RegExp(alternation, "g");
  // Function replacer: originals are inserted literally ("$&" etc. not expanded).
  const restore = (text) => text.replace(re, (m) => map.get(m));
  // Stand-ins present in text (for demo notices).
  restore.standInsIn = (text) => text.match(re) ?? [];
  return restore;
}
