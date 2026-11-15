// Final-review finding I5: non-UTF-8 text files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactText } from "../src/docs/text.js";

const spansFor = (needle, standIn) => async (texts) =>
  texts.map((t) => (t.includes(needle) ? [{ start: t.indexOf(needle), end: t.indexOf(needle) + needle.length, standIn }] : []));

function utf16le(str, bom = true) {
  const out = new Uint8Array((bom ? 2 : 0) + str.length * 2);
  let o = 0;
  if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[o++] = c & 0xff;
    out[o++] = c >> 8;
  }
  return out;
}

test("UTF-16LE with BOM is decoded, redacted and re-encoded as UTF-16LE", async () => {
  const out = await redactText(utf16le("mail a@b.io now"), spansFor("a@b.io", "X"));
  assert.deepEqual([...out.bytes], [...utf16le("mail X now")]);
  assert.equal(out.count, 1);
});

test("UTF-8 BOM is preserved", async () => {
  const input = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a@b.io")]);
  const out = await redactText(input, spansFor("a@b.io", "X"));
  assert.deepEqual([...out.bytes], [0xef, 0xbb, 0xbf, 0x58]);
});

test("invalid UTF-8 rejects (fail open with a warning, never silent corruption)", async () => {
  const cp1252 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x61, 0x40, 0x62, 0x2e, 0x69, 0x6f]); // "café a@b.io" in Windows-1252
  await assert.rejects(redactText(cp1252, spansFor("a@b.io", "X")), /not valid UTF-8/);
});
