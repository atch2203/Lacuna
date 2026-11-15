import { test } from "node:test";
import assert from "node:assert/strict";
import { findSensitive } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { guardText } from "../src/guard/guard-text.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";
const knows = (map) => (o) => map[o];

test("findSensitive finds spans without a vault", () => {
  assert.deepEqual(findSensitive(`key ${KEY}`, PATTERN_DETECTORS), [{ start: 4, end: 24, category: "API_KEY", style: "token" }]);
});

test("known value → stand-in", () => {
  assert.deepEqual(guardText(`key ${KEY}`, PATTERN_DETECTORS, knows({ [KEY]: "[API_KEY_1]" })), {
    text: "key [API_KEY_1]",
    pending: [],
    changed: true,
  });
});

test("unknown value → same-length mask, reported as pending", () => {
  assert.deepEqual(guardText(`key ${KEY}`, PATTERN_DETECTORS, knows({})), {
    text: "key " + "•".repeat(20),
    pending: [KEY],
    changed: true,
  });
});

test("pending is deduplicated", () => {
  assert.deepEqual(guardText(`${KEY} and ${KEY}`, PATTERN_DETECTORS, knows({})).pending, [KEY]);
});

test("clean text unchanged", () => {
  assert.deepEqual(guardText("hello", PATTERN_DETECTORS, knows({})), { text: "hello", pending: [], changed: false });
});
