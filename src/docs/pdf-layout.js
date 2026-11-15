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

// Canvas-space box for characters [from, to) of an item, assuming uniform
// character width within the item.
export function pieceBox(item, from, to, viewportTransform) {
  const len = item.str.length || 1;
  const [, , , , tx, ty] = item.transform;
  const x0 = tx + (item.width * from) / len;
  const x1 = tx + (item.width * to) / len;
  const h = itemHeight(item);
  const [ax, ay] = apply(viewportTransform, x0, ty);
  const [bx, by] = apply(viewportTransform, x1, ty + h);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
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
