// Stand-in → original replacement. Pure.
//
// Keys and other fakes with digits/symbols match exactly. Name-like fakes
// (letters, spaces, . ' -) match case-insensitively as whole words, because
// the model often re-capitalises them ("reese grant" → "Reese Grant"); the
// original is then given the capitalisation the model used.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NAME_LIKE = /^\p{L}[\p{L} .'-]*$/u;

// Copy `pattern`'s capitalisation onto `text`: per character when lengths
// match, otherwise all-lower / all-upper / Title Case / unchanged.
export function copyCase(text, pattern) {
  if (text.length === pattern.length) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const p = pattern[i];
      out += p !== p.toLowerCase() ? text[i].toUpperCase() : p !== p.toUpperCase() ? text[i].toLowerCase() : text[i];
    }
    return out;
  }
  if (pattern === pattern.toLowerCase()) return text.toLowerCase();
  if (pattern === pattern.toUpperCase()) return text.toUpperCase();
  if (/^(\p{Lu}\p{Ll}*)([ .'-]+\p{Lu}\p{Ll}*)*$/u.test(pattern)) {
    return text.toLowerCase().replace(/(^|[ .'-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
  }
  return text;
}

// entries: Array<[standIn, original]> → { regex, resolve(matched) → original }
export function makeStandInMatcher(entries) {
  const exact = new Map(entries);
  const byLower = new Map();
  for (const [standIn, original] of entries) {
    if (NAME_LIKE.test(standIn) && !byLower.has(standIn.toLowerCase())) byLower.set(standIn.toLowerCase(), original);
  }
  const alternatives = [...exact.keys()]
    .sort((a, b) => b.length - a.length)
    .map((s) => (NAME_LIKE.test(s) ? `(?<![\\p{L}\\p{N}_])(?i:${escapeRegExp(s)})(?![\\p{L}\\p{N}_])` : escapeRegExp(s)));
  const regex = new RegExp(alternatives.join("|"), "gu");
  const resolve = (m) => exact.get(m) ?? copyCase(byLower.get(m.toLowerCase()) ?? m, m);
  return { regex, resolve };
}

// entries: Array<[standIn, original]>
export function makeRestorer(entries) {
  if (entries.length === 0) return Object.assign((text) => text, { standInsIn: () => [] });
  const { regex, resolve } = makeStandInMatcher(entries);
  // Function replacer: originals are inserted literally ("$&" etc. not expanded).
  const restore = (text) => text.replace(regex, resolve);
  // Stand-ins present in text (for demo notices).
  restore.standInsIn = (text) => text.match(regex) ?? [];
  return restore;
}

// The inverse: originals → their stand-ins, used to put placeholders back on
// screen when the extension is switched off. entries: Array<[standIn, original]>
export function makeReverser(entries) {
  return makeRestorer(entries.map(([standIn, original]) => [original, standIn]));
}
