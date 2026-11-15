import { test } from "node:test";
import assert from "node:assert/strict";
import { installCanvasGuard } from "../src/guard/canvas-guard.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";

function setup({ active = true, known = {} } = {}) {
  const calls = [];
  class Ctx {
    measureText(t) { return { width: t.length * 10 }; }
    fillText(...a) { calls.push(["fill", ...a]); }
    strokeText(...a) { calls.push(["stroke", ...a]); }
  }
  const requests = [];
  const state = { active };
  const guard = installCanvasGuard({
    proto: Ctx.prototype,
    detectors: PATTERN_DETECTORS,
    isActive: () => state.active,
    lookup: (o) => known[o],
    request: (items) => requests.push(...items),
  });
  return { ctx: new Ctx(), calls, requests, state, guard, known };
}

test("inactive → text drawn unchanged", () => {
  const { ctx, calls } = setup({ active: false });
  ctx.fillText(`key ${KEY}`, 1, 2);
  assert.deepEqual(calls, [["fill", `key ${KEY}`, 1, 2]]);
});

test("known value drawn as stand-in, squeezed to the original width", () => {
  const { ctx, calls } = setup({ known: { [KEY]: "[API_KEY_1]" } });
  ctx.fillText(`key ${KEY}`, 1, 2);
  assert.deepEqual(calls, [["fill", "key [API_KEY_1]", 1, 2, 240]]);
});

test("caller's maxWidth is respected when smaller", () => {
  const { ctx, calls } = setup({ known: { [KEY]: "[API_KEY_1]" } });
  ctx.fillText(KEY, 0, 0, 50);
  assert.equal(calls[0][4], 50);
});

test("unknown value masked and requested once", () => {
  const { ctx, calls, requests } = setup();
  ctx.fillText(KEY, 0, 0);
  ctx.fillText(KEY, 0, 20);
  assert.equal(calls[0][1], "•".repeat(20));
  assert.deepEqual(requests.map((r) => r.original), [KEY]);
});

test("strokeText is guarded too; clean text untouched", () => {
  const { ctx, calls } = setup({ known: { [KEY]: "[API_KEY_1]" } });
  ctx.strokeText(KEY, 0, 0);
  ctx.fillText("hello", 0, 0);
  assert.equal(calls[0][1], "[API_KEY_1]");
  assert.deepEqual(calls[1], ["fill", "hello", 0, 0]);
});

test("forget() lets a value be requested again", () => {
  const { ctx, requests, guard } = setup();
  ctx.fillText(KEY, 0, 0);
  guard.forgetRequests();
  ctx.fillText(KEY, 0, 0);
  assert.equal(requests.length, 2);
});
