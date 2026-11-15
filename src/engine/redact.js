// Redaction engine: run detectors, resolve overlaps, substitute. Pure.
// All steps are O(n log n) in the number of spans so large pastes stay fast.

// Longest span wins among overlapping ones, then earliest.
// Returns non-overlapping spans sorted by start.
export function resolveOverlaps(spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const s of sorted) {
    const last = kept[kept.length - 1];
    if (!last || s.start >= last.end) kept.push(s);
    else if (s.end - s.start > last.end - last.start) kept[kept.length - 1] = s;
  }
  return kept;
}

// Cheap "does this fake already appear in the text?" check: a word-set
// lookup on the fake's first word, falling back to a full scan only on a hit.
function makeAvoid(text) {
  let words = null;
  return (candidate) => {
    words ??= new Set(text.split(/[^\w.@-]+/));
    const first = candidate.split(" ")[0];
    return words.has(first) && text.includes(candidate);
  };
}

export function redact(text, detectors, vault) {
  const spans = [];
  for (const detector of detectors) {
    for (const span of detector.find(text)) {
      if (span.end > span.start) spans.push({ ...span, detector });
    }
  }
  if (spans.length === 0) return text;

  const avoid = makeAvoid(text);
  const parts = [];
  let cursor = 0;
  // Left-to-right so stand-in numbering follows reading order.
  for (const { start, end, detector } of resolveOverlaps(spans)) {
    parts.push(text.slice(cursor, start));
    parts.push(vault.standInFor(text.slice(start, end), detector.category, detector.style, avoid));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}
