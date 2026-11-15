import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, activeEntries } from "../src/engine/vault.js";
import { redact } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { makeRestorer, makeReverser } from "../src/engine/restore.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";

test("disabling an item: no longer redacted, not restored, fake kept", () => {
  const v = new Vault();
  const fake = v.standInFor(KEY, "API_KEY");
  v.setEnabled(KEY, false);
  assert.equal(v.isDisabled(KEY), true);
  assert.equal(redact(`k ${KEY}`, PATTERN_DETECTORS, v), `k ${KEY}`, "sent as-is");
  assert.deepEqual(v.entries(), [], "excluded from restore");
  assert.equal(makeRestorer(v.entries())(`k ${fake}`), `k ${fake}`, "placeholder stays visible");
  v.setEnabled(KEY, true);
  assert.equal(redact(`k ${KEY}`, PATTERN_DETECTORS, v), `k ${fake}`, "same fake after re-enabling");
});

test("removing an item forgets it completely", () => {
  const v = new Vault();
  const fake = v.standInFor(KEY, "API_KEY");
  v.remove(KEY);
  assert.equal(v.byOriginal[KEY], undefined);
  assert.equal(v.byStandIn[fake], undefined);
  assert.equal(v.isDisabled(KEY), false);
});

test("disabled state survives JSON round-trip and activeEntries respects it", () => {
  const v = new Vault();
  v.standInFor(KEY, "API_KEY");
  v.standInFor("10.20.30.40", "IP");
  v.setEnabled(KEY, false);
  const json = JSON.parse(JSON.stringify(v.toJSON()));
  assert.equal(new Vault(json).isDisabled(KEY), true);
  assert.deepEqual(activeEntries(json).map(([, o]) => o), ["10.20.30.40"]);
  assert.deepEqual(activeEntries(undefined), []);
});

test("cleared() drops disabled flags too", () => {
  const v = new Vault();
  v.standInFor(KEY, "API_KEY");
  v.setEnabled(KEY, false);
  assert.equal(v.cleared().isDisabled(KEY), false);
});

test("reverser turns restored originals back into placeholders (global disable)", () => {
  const rev = makeReverser([["AKIAQ3M8XZ1LP0VW7RTE", KEY], ["Reese Grant", "Barry Bonds"]]);
  assert.equal(rev(`Barry Bonds has ${KEY}`), "Reese Grant has AKIAQ3M8XZ1LP0VW7RTE");
});
