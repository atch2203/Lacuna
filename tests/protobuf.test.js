import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMessage, encodeMessage, getString, setString } from "../src/main/adapters/protobuf.js";

const CAPTURED = Uint8Array.from(
  "12 26 08 01 4a 22 0a 20 7a 65 62 72 61 63 61 6e 61 72 79 20 41 4b 49 41 49 4f 53 46 4f 44 4e 4e 37 45 58 41 4d 50 4c 45"
    .split(" ")
    .map((h) => parseInt(h, 16)),
);

test("decode/encode round-trips byte-identical", () => {
  assert.deepEqual(encodeMessage(decodeMessage(CAPTURED)), CAPTURED);
});

test("round-trips varint, fixed64, fixed32 fields", () => {
  const bytes = Uint8Array.from([0x08, 0x96, 0x01, 0x11, 1, 2, 3, 4, 5, 6, 7, 8, 0x1d, 9, 9, 9, 9]);
  assert.deepEqual(encodeMessage(decodeMessage(bytes)), bytes);
});

test("getString follows a field path", () => {
  assert.equal(getString(CAPTURED, [2, 9, 1]), "zebracanary AKIAIOSFODNN7EXAMPLE");
  assert.equal(getString(CAPTURED, [2, 9, 7]), undefined);
  assert.equal(getString(CAPTURED, [3]), undefined);
});

test("setString rewrites nested lengths", () => {
  const out = setString(CAPTURED, [2, 9, 1], "hi");
  assert.deepEqual([...out], [0x12, 0x08, 0x08, 0x01, 0x4a, 0x04, 0x0a, 0x02, 0x68, 0x69]);
});

test("decodeMessage throws on truncated input", () => {
  assert.throws(() => decodeMessage(Uint8Array.from([0x0a, 0x05, 0x41])));
});
