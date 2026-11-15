import { test } from "node:test";
import assert from "node:assert/strict";
import { createNodeGuard } from "../src/guard/node-guard.js";
import { guardText } from "../src/guard/guard-text.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";
const ORIGINAL = `key ${KEY}`;

function setup(known = { [KEY]: "[API_KEY_1]" }) {
  const lookup = (o) => known[o];
  const guard = createNodeGuard({ transform: (text) => guardText(text, PATTERN_DETECTORS, lookup) });
  return { guard, known };
}

function node(value) {
  let v = value;
  const n = { writes: 0 };
  Object.defineProperty(n, "nodeValue", { get: () => v, set: (x) => { v = x; n.writes++; } });
  return n;
}

test("known value replaced", () => {
  const { guard } = setup();
  const n = node(ORIGINAL);
  assert.deepEqual(guard.process(n), []);
  assert.equal(n.nodeValue, "key [API_KEY_1]");
});

test("unknown value masked and returned as pending", () => {
  const { guard } = setup({});
  const n = node(ORIGINAL);
  assert.deepEqual(guard.process(n).map((p) => p.original), [KEY]);
  assert.equal(n.nodeValue, "key " + "•".repeat(20));
});

test("reprocessAll swaps masks for stand-ins once known", () => {
  const { guard, known } = setup({});
  const n = node(ORIGINAL);
  guard.process(n);
  known[KEY] = "[API_KEY_1]";
  guard.reprocessAll();
  assert.equal(n.nodeValue, "key [API_KEY_1]");
});

test("page re-renders the original → re-guarded", () => {
  const { guard } = setup();
  const n = node(ORIGINAL);
  guard.process(n);
  n.nodeValue = ORIGINAL;
  guard.process(n);
  assert.equal(n.nodeValue, "key [API_KEY_1]");
});

test("already-guarded unchanged node → no write", () => {
  const { guard } = setup();
  const n = node(ORIGINAL);
  guard.process(n);
  const writes = n.writes;
  assert.deepEqual(guard.process(n), []);
  assert.equal(n.writes, writes);
});

test("restoreAll restores untouched nodes", () => {
  const { guard } = setup();
  const n = node(ORIGINAL);
  guard.process(n);
  guard.restoreAll();
  assert.equal(n.nodeValue, ORIGINAL);
});

test("restoreAll leaves nodes the page changed since", () => {
  const { guard } = setup();
  const n = node(ORIGINAL);
  guard.process(n);
  n.nodeValue = "new text";
  guard.restoreAll();
  assert.equal(n.nodeValue, "new text");
});

test("after restoreAll, nodes are forgotten", () => {
  const { guard } = setup();
  const n = node(ORIGINAL);
  guard.process(n);
  guard.restoreAll();
  n.nodeValue = "page text";
  guard.restoreAll();
  assert.equal(n.nodeValue, "page text");
});
