// Spans for restoring stand-ins to originals: the reverse of redaction, in
// the same { start, end, standIn } shape the document handlers consume
// (here `standIn` holds the ORIGINAL to write back). Pure.
//
// entries: Array<[standIn, original]>

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function restoreSpansFor(texts, entries) {
  if (entries.length === 0) return texts.map(() => []);
  const map = new Map(entries);
  const re = new RegExp(
    [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|"),
    "g",
  );
  return texts.map((text) =>
    [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length, standIn: map.get(m[0]) })),
  );
}
