import { test } from "node:test";
import assert from "node:assert/strict";
import { sentNotice, fileNotice, restoredNotice, guardNotice, copiedNotice, createAggregator } from "../src/demo/notices.js";

const swaps = [
  { original: "jane@corp.io", standIn: "jordan.lee@example.com" },
  { original: "AKIAIOSFODNN7EXAMPLE", standIn: "[API_KEY_1]" },
];

test("sent notice lists swaps", () => {
  const n = sentNotice("claude.ai", swaps, { guardActive: false });
  assert.equal(n, "↑ Sent to claude.ai — 2 swaps\njane@corp.io → jordan.lee@example.com\nAKIAIOSFODNN7EXAMPLE → [API_KEY_1]");
});

test("file notice lists every swap", () => {
  assert.equal(
    fileNotice("brief.pdf", swaps),
    "📄 brief.pdf — 2 swaps\njane@corp.io → jordan.lee@example.com\nAKIAIOSFODNN7EXAMPLE → [API_KEY_1]",
  );
});

test("while guarding, notices never show originals", () => {
  const n = sentNotice("claude.ai", swaps, { guardActive: true });
  assert.ok(!n.includes("jane") && !n.includes("AKIA"), n);
  assert.match(n, /→ jordan\.lee@example\.com/);
  assert.equal(fileNotice("brief.pdf", swaps, { guardActive: true }), "📄 brief.pdf — 2 swaps\n→ jordan.lee@example.com\n→ [API_KEY_1]");
});

test("long originals are truncated", () => {
  const n = sentNotice("x", [{ original: "a".repeat(40), standIn: "S" }], { guardActive: false });
  assert.match(n, new RegExp(`^${"a".repeat(23)}… → S$`, "m"));
});

test("singular wording", () => {
  assert.equal(sentNotice("x", [swaps[1]], { guardActive: true }), "↑ Sent to x — 1 swap\n→ [API_KEY_1]");
  assert.equal(restoredNotice(1), "↓ Restored 1 value in reply");
  assert.equal(copiedNotice(2), "📋 Copied with 2 real values");
});

test("guard notices", () => {
  assert.equal(guardNotice({ active: true, reason: "share", hidden: 7 }), "🛡 Screen guard ON (sharing) — 7 values hidden");
  assert.equal(guardNotice({ active: false }), "🛡 Screen guard OFF");
});

test("aggregator sums within the window and flushes once", () => {
  let fire;
  const flushed = [];
  const add = createAggregator((total) => flushed.push(total), 1500, (fn) => (fire = fn));
  add(2);
  add(3);
  assert.deepEqual(flushed, []);
  fire();
  assert.deepEqual(flushed, [5]);
  add(0);
  assert.deepEqual(flushed, [5], "zero is ignored");
});
