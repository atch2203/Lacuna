// Spans for restoring stand-ins to originals: the reverse of redaction, in
// the same { start, end, standIn } shape the document handlers consume
// (here `standIn` holds the ORIGINAL to write back). Pure.
//
// entries: Array<[standIn, original]>
import { makeStandInMatcher } from "../engine/restore.js";

export function restoreSpansFor(texts, entries) {
  if (entries.length === 0) return texts.map(() => []);
  const { regex, resolve } = makeStandInMatcher(entries);
  return texts.map((text) =>
    [...text.matchAll(regex)].map((m) => ({ start: m.index, end: m.index + m[0].length, standIn: resolve(m[0]) })),
  );
}
