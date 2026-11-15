import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPageText, spanPieces, pieceBox, itemTexts } from "../src/docs/pdf-layout.js";

const item = (str, x, y, width, size = 10) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size });

test("same baseline with a gap joins with a space", () => {
  const { text, ranges } = buildPageText([item("mail", 72, 700, 20), item("jane@corp.io", 96, 700, 60)]);
  assert.equal(text, "mail jane@corp.io");
  assert.deepEqual(ranges, [[0, 4], [5, 17]]);
});

test("different baselines join with a newline", () => {
  const { text } = buildPageText([item("line one", 72, 700, 40), item("line two", 72, 680, 40)]);
  assert.equal(text, "line one\nline two");
});

test("adjacent items with no gap join with nothing", () => {
  const { text } = buildPageText([item("jane@", 72, 700, 25), item("corp.io", 97, 700, 35)]);
  assert.equal(text, "jane@corp.io");
});

test("no extra space when the joint already has whitespace", () => {
  const { text } = buildPageText([item("mail ", 72, 700, 25), item("x", 110, 700, 5)]);
  assert.equal(text, "mail x");
});

test("empty items get empty ranges and no separators", () => {
  const { text, ranges } = buildPageText([item("a", 72, 700, 5), item("", 77, 700, 0), item("b", 90, 700, 5)]);
  assert.equal(text, "a b");
  assert.deepEqual(ranges[1][0], ranges[1][1]);
});

test("value split across two items → pieces and hidden texts", () => {
  const items = [item("jane@", 72, 700, 25), item("corp.io", 97, 700, 35)];
  const { ranges, text } = buildPageText(items);
  const span = { start: 0, end: 12, standIn: "S" };
  assert.deepEqual(spanPieces(ranges, span), [
    { item: 0, from: 0, to: 5 },
    { item: 1, from: 0, to: 7 },
  ]);
  assert.deepEqual(itemTexts(text, ranges, [span]), ["S", ""]);
});

test("itemTexts: span starting in a separator still places the stand-in", () => {
  const items = [item("a", 72, 700, 5), item("XY", 90, 700, 10)];
  const { text, ranges } = buildPageText(items); // "a XY"
  assert.deepEqual(itemTexts(text, ranges, [{ start: 1, end: 4, standIn: "S" }]), ["a", "S"]);
});

test("pieceBox with identity viewport", () => {
  const it = { str: "abcd", transform: [10, 0, 0, 10, 100, 200], width: 40, height: 10 };
  assert.deepEqual(pieceBox(it, 1, 3, [1, 0, 0, 1, 0, 0]), { x: 110, y: 200, w: 20, h: 10 });
});

test("pieceBox with flipped scale-2 viewport", () => {
  const it = { str: "abcd", transform: [10, 0, 0, 10, 100, 200], width: 40, height: 10 };
  assert.deepEqual(pieceBox(it, 1, 3, [2, 0, 0, -2, 0, 1584]), { x: 220, y: 1584 - 2 * 210, w: 40, h: 20 });
});

test("pieceBox falls back to transform scale when height is 0", () => {
  const it = { str: "ab", transform: [12, 0, 0, 12, 0, 0], width: 10, height: 0 };
  assert.equal(pieceBox(it, 0, 2, [1, 0, 0, 1, 0, 0]).h, 12);
});

test("pieceBox uses a measure function for proportional fonts", () => {
  // "WWii": W is 3 units wide, i is 1 → total 8. Chars [2,4) start at 6/8 of width.
  const measure = (s) => [...s].reduce((n, ch) => n + (ch === "W" ? 3 : 1), 0);
  const it = { str: "WWii", transform: [10, 0, 0, 10, 100, 200], width: 80, height: 10 };
  const box = pieceBox(it, 2, 4, [1, 0, 0, 1, 0, 0], { measure, padEm: 0 });
  assert.deepEqual({ x: box.x, w: box.w }, { x: 160, w: 20 });
});

test("pieceBox pads horizontally by padEm × height", () => {
  const it = { str: "abcd", transform: [10, 0, 0, 10, 100, 200], width: 40, height: 10 };
  const box = pieceBox(it, 1, 3, [1, 0, 0, 1, 0, 0], { padEm: 0.2 });
  assert.deepEqual({ x: box.x, w: box.w }, { x: 108, w: 24 });
});
