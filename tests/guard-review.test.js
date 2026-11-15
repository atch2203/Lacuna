// Final-review findings for the screen-share guard: C1, I2, I4, I5, I6, I7.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, guardOf, MAX_SHARES_PER_TAB } from "../src/guard/share-registry.js";
import { installShareDetector } from "../src/guard/share-detector.js";
import { guardText } from "../src/guard/guard-text.js";
import { createNodeGuard } from "../src/guard/node-guard.js";
import { assignGuardStandIns, MAX_GUARD_ENTRIES } from "../src/guard/guard-vault.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { Vault } from "../src/engine/vault.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";
const run = (...events) => events.reduce(reduce, initialState());

// --- I4: shares keyed by frame; reset per frame -----------------------------
test("share-reset drops only the resetting frame's shares", () => {
  const s = run(
    { type: "share-started", tabId: 1, frameId: 0, shareId: "a", surface: "window" },
    { type: "share-started", tabId: 1, frameId: 7, shareId: "b", surface: "window" },
    { type: "share-reset", tabId: 1, frameId: 7 },
  );
  assert.deepEqual(Object.keys(s.shares), ["1:0:a"]);
  assert.equal(guardOf(s).active, true);
});

test("share-ended matches tab, frame and id", () => {
  const s = run(
    { type: "share-started", tabId: 1, frameId: 3, shareId: "a" },
    { type: "share-ended", tabId: 1, frameId: 3, shareId: "a" },
  );
  assert.equal(guardOf(s).active, false);
});

// --- C1: a page can't register unbounded shares -----------------------------
test("shares per tab are capped", () => {
  const events = Array.from({ length: MAX_SHARES_PER_TAB + 5 }, (_, i) => ({
    type: "share-started", tabId: 9, frameId: 0, shareId: `s${i}`,
  }));
  assert.equal(Object.keys(run(...events).shares).length, MAX_SHARES_PER_TAB);
});

// --- I2: guard turns on when the picker opens; cancel turns it off ---------
function detector({ reject = false } = {}) {
  class Track extends EventTarget {
    constructor() { super(); this.kind = "video"; }
    getSettings() { return { displaySurface: "monitor" }; }
    stop() {}
  }
  let resolveIt, rejectIt;
  const mediaDevices = {
    getDisplayMedia: () => new Promise((res, rej) => { resolveIt = () => res({ getTracks: () => [new Track()] }); rejectIt = () => rej(new Error("NotAllowedError")); }),
  };
  const reports = [];
  installShareDetector({ mediaDevices, trackProto: Track.prototype, report: (r) => reports.push(r), newId: () => "s1" });
  return { mediaDevices, reports, resolve: () => resolveIt(), reject: () => rejectIt() };
}

test("share is reported as soon as getDisplayMedia is called (picker open)", async () => {
  const d = detector();
  const p = d.mediaDevices.getDisplayMedia();
  assert.deepEqual(d.reports, [{ type: "share-started", shareId: "s1", surface: "pending" }]);
  d.resolve();
  await p;
  assert.deepEqual(d.reports[1], { type: "share-started", shareId: "s1", surface: "monitor" });
});

test("cancelling the picker reports share-ended", async () => {
  const d = detector();
  const p = d.mediaDevices.getDisplayMedia();
  d.reject();
  await assert.rejects(p);
  assert.deepEqual(d.reports.at(-1), { type: "share-ended", shareId: "s1" });
});

// --- I5: pending carries category/style; I6: stand-ins aren't re-masked -----
test("pending items carry category and style", () => {
  const out = guardText(`key ${KEY}`, PATTERN_DETECTORS, () => undefined, () => false);
  assert.deepEqual(out.pending, [{ original: KEY, category: "API_KEY", style: "token" }]);
});

test("known stand-ins are left alone, not masked", () => {
  const isStandIn = (s) => s === "jordan.lee@example.com";
  const out = guardText("mail jordan.lee@example.com", PATTERN_DETECTORS, () => undefined, isStandIn);
  assert.deepEqual(out, { text: "mail jordan.lee@example.com", pending: [], changed: false });
});

// --- I5 + C1: guard stand-ins live in a capped, session-only map ------------
test("assignGuardStandIns uses category directly (context-only detectors work)", () => {
  const out = assignGuardStandIns(new Vault().toJSON(), new Vault().toJSON(), [{ original: "hunter2", category: "SECRET", style: "token" }]);
  assert.equal(out.byOriginal.hunter2, "[SECRET_1]");
});

test("guard stand-ins never collide with persistent vault stand-ins", () => {
  const persistent = new Vault();
  persistent.standInFor("10.0.0.1", "IP", "token"); // [IP_1]
  const out = assignGuardStandIns(new Vault().toJSON(), persistent.toJSON(), [{ original: "10.0.0.2", category: "IP", style: "token" }]);
  assert.notEqual(out.byOriginal["10.0.0.2"], "[IP_1]");
});

test("guard map is capped", () => {
  const items = Array.from({ length: MAX_GUARD_ENTRIES + 10 }, (_, i) => ({ original: `v${i}`, category: "OTHER", style: "token" }));
  const out = assignGuardStandIns(new Vault().toJSON(), new Vault().toJSON(), items);
  assert.equal(Object.keys(out.byOriginal).length, MAX_GUARD_ENTRIES);
});

test("values already in the persistent vault are not duplicated", () => {
  const persistent = new Vault();
  persistent.standInFor(KEY, "API_KEY", "token");
  const out = assignGuardStandIns(new Vault().toJSON(), persistent.toJSON(), [{ original: KEY, category: "API_KEY", style: "token" }]);
  assert.deepEqual(out.byOriginal, {});
});

// --- I7: detached + re-attached nodes keep their real original --------------
test("node detached during a vault change, then re-attached, restores to the real original", () => {
  const known = {};
  const guard = createNodeGuard({ transform: (t) => guardText(t, PATTERN_DETECTORS, (o) => known[o], () => false) });
  const n = { nodeValue: `key ${KEY}`, isConnected: true };
  guard.process(n);
  n.isConnected = false;
  known[KEY] = "[API_KEY_1]";
  guard.reprocessAll();
  n.isConnected = true;
  guard.process(n);
  guard.reprocessAll();
  assert.equal(n.nodeValue, "key [API_KEY_1]");
  guard.restoreAll();
  assert.equal(n.nodeValue, `key ${KEY}`);
});
