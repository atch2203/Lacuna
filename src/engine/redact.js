// Redaction engine: run detectors, resolve overlaps, substitute. Pure.

// Longest span wins, then earliest. Returns non-overlapping spans sorted by start.
export function resolveOverlaps(spans) {
  const ranked = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept = [];
  for (const s of ranked) {
    if (kept.every((k) => s.end <= k.start || s.start >= k.end)) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function redact(text, detectors, vault) {
  const spans = [];
  for (const detector of detectors) {
    for (const span of detector.find(text)) {
      if (span.end > span.start) spans.push({ ...span, detector });
    }
  }
  if (spans.length === 0) return text;

  // Assign stand-ins left-to-right (so numbering follows reading order),
  // then splice right-to-left (so earlier offsets stay valid).
  const resolved = resolveOverlaps(spans).map((s) => ({
    ...s,
    standIn: vault.standInFor(text.slice(s.start, s.end), s.detector.category, s.detector.style, text),
  }));
  let out = text;
  for (const { start, end, standIn } of resolved.reverse()) {
    out = out.slice(0, start) + standIn + out.slice(end);
  }
  return out;
}
