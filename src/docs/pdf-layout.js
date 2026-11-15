// Pure PDF text geometry helpers. TextItem = pdf.js text item:
//   { str, transform: [a, b, c, d, e, f], width, height }
// (e, f) is the baseline origin in PDF user space; text assumed horizontal.

function itemHeight(item) {
  return item.height || Math.hypot(item.transform[2], item.transform[3]);
}

// Join items into one page string. Newline between items on different
// baselines; nothing when an item starts right where the previous one ends;
// otherwise a space unless the joint already has whitespace.
export function buildPageText(items) {
  let text = "";
  const ranges = [];
  let prev = null;
  for (const item of items) {
    if (!item.str) {
      ranges.push([text.length, text.length]);
      continue;
    }
    if (prev) {
      const h = Math.max(itemHeight(prev), itemHeight(item));
      const sameLine = Math.abs(item.transform[5] - prev.transform[5]) <= 0.5 * h;
      const touching = item.transform[4] <= prev.transform[4] + prev.width + 0.15 * h;
      const joint = /\s$/.test(text) || /^\s/.test(item.str);
      if (!sameLine) text += "\n";
      else if (!touching && !joint) text += " ";
    }
    ranges.push([text.length, text.length + item.str.length]);
    text += item.str;
    prev = item;
  }
  return { text, ranges };
}

// Character offsets within each item a span touches.
export function spanPieces(ranges, span) {
  const pieces = [];
  ranges.forEach(([rs, re], i) => {
    if (re <= rs || span.start >= re || span.end <= rs) return;
    pieces.push({ item: i, from: Math.max(span.start, rs) - rs, to: Math.min(span.end, re) - rs });
  });
  return pieces;
}

function apply([a, b, c, d, e, f], x, y) {
  return [a * x + c * y + e, b * x + d * y + f];
}

// Canvas-space box for characters [from, to) of an item.
// measure(str) → width in any unit; with it, offsets follow the real
// (proportional) glyph widths, otherwise characters are assumed equal width.
// padEm widens the box on both sides by padEm × text height, so glyph edges
// of the original never peek out.
export function pieceBox(item, from, to, viewportTransform, { measure, padEm = 0 } = {}) {
  const str = item.str;
  let f0 = from / (str.length || 1);
  let f1 = to / (str.length || 1);
  const total = measure ? measure(str) : 0;
  if (total > 0) {
    f0 = measure(str.slice(0, from)) / total;
    f1 = measure(str.slice(0, to)) / total;
  }
  // Text direction u = (a, b) and ascent direction v = (c, d), normalized,
  // so rotated and vertical text get the right quad.
  const [a, b, c, d, tx, ty] = item.transform;
  const su = Math.hypot(a, b) || 1;
  const sv = Math.hypot(c, d) || 1;
  const [ux, uy] = [a / su, b / su];
  const [vx, vy] = [c / sv, d / sv];
  const h = itemHeight(item);
  const pad = padEm * h;
  const s0 = item.width * f0 - pad;
  const s1 = item.width * f1 + pad;
  const corners = [
    [tx + ux * s0, ty + uy * s0],
    [tx + ux * s1, ty + uy * s1],
    [tx + ux * s0 + vx * h, ty + uy * s0 + vy * h],
    [tx + ux * s1 + vx * h, ty + uy * s1 + vy * h],
  ].map(([x, y]) => apply(viewportTransform, x, y));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// Redacted text per item, for the hidden text layer: each stand-in goes in
// the first item its span touches; covered characters are removed.
export function itemTexts(text, ranges, spans) {
  const placed = new Set();
  return ranges.map(([rs, re]) => {
    let out = "";
    let pos = rs;
    for (const s of spans) {
      if (re <= rs || s.start >= re || s.end <= rs) continue;
      out += text.slice(pos, Math.max(s.start, rs));
      if (!placed.has(s)) {
        out += s.standIn;
        placed.add(s);
      }
      pos = Math.min(s.end, re);
    }
    return out + text.slice(pos, re);
  });
}
