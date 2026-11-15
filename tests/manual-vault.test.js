import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "../src/engine/vault.js";
import { manualDetectors, classifyValue } from "../src/engine/manual.js";
import { redact } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";

const detectorsFor = (v) => [...PATTERN_DETECTORS, ...manualDetectors(v)];

test("classifyValue uses the detector that matches the whole value, else SECRET", () => {
  assert.equal(classifyValue("AKIAIOSFODNN7EXAMPLE"), "API_KEY");
  assert.equal(classifyValue("10.20.30.40"), "IP");
  assert.equal(classifyValue("jane@corp.io"), "EMAIL");
  assert.equal(classifyValue("hunter2"), "SECRET");
  assert.equal(classifyValue("prod-db-7.internal"), "SECRET");
});

test("a manually added value gets a fake before it is ever sent", () => {
  const v = new Vault();
  const fake = v.addManual("AKIAIOSFODNN7EXAMPLE");
  assert.ok(fake.startsWith("AKIA") && fake.length === 20);
  assert.equal(v.isManual("AKIAIOSFODNN7EXAMPLE"), true);
  assert.equal(redact("k AKIAIOSFODNN7EXAMPLE", detectorsFor(v), v), `k ${fake}`);
});

test("values no pattern detects are redacted once added", () => {
  const v = new Vault();
  const fake = v.addManual("hunter2");
  assert.match(fake, /^[a-z]{6}\d$/);
  assert.equal(redact("the password is hunter2.", detectorsFor(v), v), `the password is ${fake}.`);
  assert.equal(redact("hunter22 is different", detectorsFor(v), v), "hunter22 is different", "whole value only");
});

test("manual matching is exact (case-sensitive)", () => {
  const v = new Vault();
  v.addManual("Hunter2");
  assert.equal(redact("hunter2", detectorsFor(v), v), "hunter2");
});

test("removing a manual entry stops detecting it; disabling sends it as-is", () => {
  const v = new Vault();
  v.addManual("hunter2");
  v.setEnabled("hunter2", false);
  assert.equal(redact("hunter2", detectorsFor(v), v), "hunter2");
  v.setEnabled("hunter2", true);
  v.remove("hunter2");
  assert.equal(v.isManual("hunter2"), false);
  assert.equal(redact("hunter2", detectorsFor(v), v), "hunter2");
});

test("adding an existing value keeps its fake; blank values are ignored", () => {
  const v = new Vault();
  const first = v.standInFor("10.20.30.40", "IP");
  assert.equal(v.addManual("10.20.30.40"), first);
  assert.equal(v.addManual("   "), undefined);
});

test("manual entries survive JSON round-trip; detectors work from JSON", () => {
  const v = new Vault();
  const fake = v.addManual("hunter2");
  const json = JSON.parse(JSON.stringify(v.toJSON()));
  const v2 = new Vault(json);
  assert.equal(redact("x hunter2", [...manualDetectors(json)], v2), `x ${fake}`);
});

// Bug: a name added by hand was a SECRET, and its first name wasn't detected.
test("Auto classifies name-like values as PERSON", () => {
  assert.equal(classifyValue("Barry Bonds"), "PERSON");
  assert.equal(classifyValue("Mary Ann Smith"), "PERSON");
  assert.equal(classifyValue("barry bonds"), "SECRET", "lowercase isn't assumed to be a name");
  assert.equal(classifyValue("Project Falcon"), "PERSON", "heuristic: capitalised words read as a name; user can pick Org/Other");
});

test("a person added by hand behaves like a dictionary person (parts, any case)", () => {
  const v = new Vault();
  const fake = v.addManual("Barry Bonds");
  const [first, last] = fake.split(" ");
  const out = redact("Barry Bonds / barry / Bonds", detectorsFor(v), v);
  assert.equal(out, `${fake} / ${first.toLowerCase()} / ${last}`);
});

test("ORG added by hand is matched case-insensitively", () => {
  const v = new Vault();
  const fake = v.addManual("Acme Corp", "ORG");
  assert.equal(redact("at acme corp", detectorsFor(v), v), `at ${fake.toLowerCase()}`);
});
