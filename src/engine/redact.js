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

// Non-overlapping, sorted sensitive spans; no vault access.
export function findSensitive(text, detectors) {
  const spans = [];
  for (const detector of detectors) {
    for (const span of detector.find(text)) {
      if (span.end > span.start) spans.push({ ...span, detector });
    }
  }
  return resolveOverlaps(spans).map(({ start, end, detector }) => ({
    start,
    end,
    category: detector.category,
    style: detector.style,
  }));
}

// Like findSensitive, plus stand-ins assigned left-to-right (so numbering
// follows reading order).
export function findRedactions(text, detectors, vault) {
  const spans = findSensitive(text, detectors);
  if (spans.length === 0) return [];
  const avoid = makeAvoid(text);
  return spans.map(({ start, end, category, style }) => ({
    start,
    end,
    standIn: vault.standInFor(text.slice(start, end), category, style, avoid),
  }));
}

export function redact(text, detectors, vault) {
  const spans = findRedactions(text, detectors, vault);
  if (spans.length === 0) return text;
  const parts = [];
  let cursor = 0;
  for (const { start, end, standIn } of spans) {
    parts.push(text.slice(cursor, start), standIn);
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}
