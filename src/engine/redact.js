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

function detectedSpans(text, detectors) {
  const spans = [];
  for (const detector of detectors) {
    for (const span of detector.find(text)) {
      if (span.end > span.start) spans.push({ ...span, detector });
    }
  }
  return resolveOverlaps(spans);
}

// Non-overlapping, sorted sensitive spans; no vault access.
export function findSensitive(text, detectors) {
  return detectedSpans(text, detectors).map(({ start, end, detector }) => ({
    start,
    end,
    category: detector.category,
    style: detector.style,
  }));
}

function matchCaseOf(word, original) {
  if (original === original.toLowerCase()) return word.toLowerCase();
  if (original === original.toUpperCase()) return word.toUpperCase();
  return word;
}

// A name part maps to the same word of the full name's fake, so "Jane" and
// "Doe" agree with "Jane Doe" whichever appears first.
function partStandIn(original, detector, vault, avoid) {
  const full = vault.standInFor(detector.fullTerm, detector.category, detector.style, avoid);
  const word = full.split(" ")[detector.partIndex];
  if (!word) return vault.standInFor(original, detector.category, detector.style, avoid);
  const standIn = matchCaseOf(word, original);
  vault.link(original, standIn);
  return standIn;
}

// Like findSensitive, plus stand-ins assigned left-to-right (so numbering
// follows reading order).
// Spans that already are stand-ins (e.g. a fake pasted back from a reply)
// are left alone, so a fake never gets its own fake.
export function findRedactions(text, detectors, vault) {
  const spans = detectedSpans(text, detectors).filter(({ start, end }) => !vault.isStandIn?.(text.slice(start, end)));
  if (spans.length === 0) return [];
  const avoid = makeAvoid(text);
  return spans.map(({ start, end, detector }) => {
    const original = text.slice(start, end);
    const standIn =
      detector.fullTerm !== undefined
        ? partStandIn(original, detector, vault, avoid)
        : vault.standInFor(original, detector.category, detector.style, avoid);
    return { start, end, standIn };
  });
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
