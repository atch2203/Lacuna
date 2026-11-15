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

// Copy the original's capitalisation onto a fake of the same length.
function withCaseOf(fake, original) {
  if (fake.length !== original.length) {
    if (original === original.toLowerCase()) return fake.toLowerCase();
    if (original === original.toUpperCase()) return fake.toUpperCase();
    return fake;
  }
  let out = "";
  for (let i = 0; i < fake.length; i++) {
    const o = original[i];
    out += o !== o.toLowerCase() ? fake[i].toUpperCase() : o !== o.toUpperCase() ? fake[i].toLowerCase() : fake[i];
  }
  return out;
}

// Dictionary matches derive their fake from the canonical term, so every
// capitalisation ("Jane Doe", "jane doe") and every name part ("Jane",
// "doe") stays consistent with the full name's fake.
function dictionaryStandIn(original, detector, vault, avoid) {
  const canonical = detector.fullTerm ?? detector.canonical;
  const base = vault.standInFor(canonical, detector.category, detector.style, avoid);
  if (detector.fullTerm === undefined && original === canonical) return base;
  const word = detector.fullTerm === undefined ? base : base.split(" ")[detector.partIndex];
  if (!word) return vault.standInFor(original, detector.category, detector.style, avoid);
  // Always (re)derive from the full name's CURRENT placeholder, so a part that
  // got its own fake earlier, or a placeholder edited later, is re-aligned
  // (setStandIn keeps the previous placeholder as an alias for old chats).
  const desired = withCaseOf(word, original);
  if (vault.byOriginal[original] === undefined) vault.link(original, desired);
  else if (vault.byOriginal[original] !== desired) vault.setStandIn(original, desired);
  return vault.byOriginal[original] ?? desired;
}

// Like findSensitive, plus stand-ins assigned left-to-right (so numbering
// follows reading order).
// Spans that already are stand-ins (e.g. a fake pasted back from a reply)
// are left alone, so a fake never gets its own fake.
export function findRedactions(text, detectors, vault) {
  const spans = detectedSpans(text, detectors).filter(({ start, end, detector }) => {
    const original = text.slice(start, end);
    if (vault.isStandIn?.(original)) return false;
    // Items the user switched off are sent as-is (a disabled dictionary term
    // switches off its capitalisations and name parts too).
    const canonical = detector.fullTerm ?? detector.canonical;
    return !vault.isDisabled?.(original) && !(canonical !== undefined && vault.isDisabled?.(canonical));
  });
  if (spans.length === 0) return [];
  const avoid = makeAvoid(text);
  return spans.map(({ start, end, detector }) => {
    const original = text.slice(start, end);
    const standIn =
      detector.fullTerm !== undefined || detector.canonical !== undefined
        ? dictionaryStandIn(original, detector, vault, avoid)
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
