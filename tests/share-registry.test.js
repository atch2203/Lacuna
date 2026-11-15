import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, guardOf } from "../src/guard/share-registry.js";

const run = (...events) => events.reduce(reduce, initialState());
const start = (tabId, shareId, surface = "window") => ({ type: "share-started", tabId, shareId, surface });

test("share start → active (share)", () => {
  assert.deepEqual(guardOf(run(start(1, "a"))), { active: true, reason: "share" });
});

test("start then end → inactive", () => {
  assert.deepEqual(guardOf(run(start(1, "a"), { type: "share-ended", tabId: 1, shareId: "a" })), { active: false, reason: null });
});

test("two shares, one ends → still active", () => {
  assert.equal(guardOf(run(start(1, "a"), start(2, "b"), { type: "share-ended", tabId: 1, shareId: "a" })).active, true);
});

test("meeting tab closed → inactive", () => {
  assert.equal(guardOf(run(start(5, "a"), { type: "tab-removed", tabId: 5 })).active, false);
});

test("share-reset drops only that tab", () => {
  const s = run(start(5, "a"), start(6, "b"), { type: "share-reset", tabId: 5 });
  assert.deepEqual(Object.keys(s.shares), ["6:b"]);
});

test("manual switch", () => {
  assert.deepEqual(guardOf(run({ type: "manual", on: true })), { active: true, reason: "manual" });
  assert.deepEqual(guardOf(run({ type: "manual", on: true }, start(1, "a"))), { active: true, reason: "share" });
  assert.equal(guardOf(run({ type: "manual", on: true }, { type: "manual", on: false })).active, false);
});

test("ending an unknown share is a no-op", () => {
  assert.deepEqual(run({ type: "share-ended", tabId: 1, shareId: "zzz" }), initialState());
});

test("reduce does not mutate its input", () => {
  const s = run(start(1, "a"));
  const frozen = JSON.stringify(s);
  reduce(s, start(2, "b"));
  reduce(s, { type: "tab-removed", tabId: 1 });
  assert.equal(JSON.stringify(s), frozen);
});
