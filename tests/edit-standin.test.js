import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, activeEntries } from "../src/engine/vault.js";
import { redact } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { makeRestorer } from "../src/engine/restore.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";

test("editing a placeholder: new prompts use it, old one still restores", () => {
  const v = new Vault();
  const old = v.standInFor(KEY, "API_KEY");
  assert.deepEqual(v.setStandIn(KEY, "AKIA0000DEMO0000KEY0"), { ok: true });
  assert.equal(redact(`k ${KEY}`, PATTERN_DETECTORS, v), "k AKIA0000DEMO0000KEY0");
  const r = makeRestorer(v.entries());
  assert.equal(r(`old ${old} new AKIA0000DEMO0000KEY0`), `old ${KEY} new ${KEY}`);
});

test("rejects empty, unchanged-to-original, and placeholders used elsewhere", () => {
  const v = new Vault();
  v.standInFor(KEY, "API_KEY");
  const ipFake = v.standInFor("10.20.30.40", "IP");
  assert.match(v.setStandIn(KEY, "  ").error, /empty/);
  assert.match(v.setStandIn(KEY, KEY).error, /same as the real value/);
  assert.match(v.setStandIn(KEY, ipFake).error, /already used/);
  assert.match(v.setStandIn(KEY, "10.20.30.40").error, /already used/);
  assert.match(v.setStandIn("not-in-vault", "x").error, /not in the vault/);
});

test("setting the current placeholder again is a no-op", () => {
  const v = new Vault();
  const cur = v.standInFor(KEY, "API_KEY");
  assert.deepEqual(v.setStandIn(KEY, cur), { ok: true });
  assert.equal(v.byOriginal[KEY], cur);
});

test("remove clears old aliases too", () => {
  const v = new Vault();
  const old = v.standInFor(KEY, "API_KEY");
  v.setStandIn(KEY, "AKIA0000DEMO0000KEY0");
  v.remove(KEY);
  assert.deepEqual(activeEntries(v), []);
  assert.equal(v.byStandIn[old], undefined);
});

test("currentEntries lists one [standIn, original] per original (the current one)", () => {
  const v = new Vault();
  v.standInFor(KEY, "API_KEY");
  v.setStandIn(KEY, "AKIA0000DEMO0000KEY0");
  assert.deepEqual(v.currentEntries(), [["AKIA0000DEMO0000KEY0", KEY]]);
});
