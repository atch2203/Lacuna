import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "../src/engine/vault.js";
import { fakeFor, tokenFor } from "../src/engine/fakes.js";

test("tokenFor formats [CATEGORY_N]", () => {
  assert.equal(tokenFor("API_KEY", 1), "[API_KEY_1]");
});

test("fakeFor gives distinct values for distinct n", () => {
  const seen = new Set();
  for (let n = 1; n <= 200; n++) seen.add(fakeFor("PERSON", n));
  assert.equal(seen.size, 200);
});

test("same original → same stand-in", () => {
  const v = new Vault();
  assert.equal(v.standInFor("a@b.com", "EMAIL", "fake"), v.standInFor("a@b.com", "EMAIL", "fake"));
});

test("tokens count per category", () => {
  const v = new Vault();
  assert.equal(v.standInFor("k1", "API_KEY", "token"), "[API_KEY_1]");
  assert.equal(v.standInFor("k2", "API_KEY", "token"), "[API_KEY_2]");
  assert.equal(v.standInFor("4111111111111111", "CARD", "token"), "[CARD_1]");
});

test("fake email shape", () => {
  assert.match(new Vault().standInFor("x@corp.io", "EMAIL", "fake"), /^[a-z]+\.[a-z]+@example\.com$/);
});

test("fake phone in 555-0100..0199", () => {
  assert.match(new Vault().standInFor("413-555-8812", "PHONE", "fake"), /^555-01\d\d$/);
});

test("fake skips values present in avoid text", () => {
  const first = fakeFor("PERSON", 1);
  const v = new Vault();
  assert.notEqual(v.standInFor("Alice Real", "PERSON", "fake", `hi ${first}`), first);
});

test("fake never reuses an existing stand-in", () => {
  const v = new Vault();
  const a = v.standInFor("Alice Real", "PERSON", "fake");
  const b = v.standInFor("Bob Real", "PERSON", "fake");
  assert.notEqual(a, b);
});

test("round-trips through JSON", () => {
  const v = new Vault();
  const s = v.standInFor("k1", "API_KEY", "token");
  const v2 = new Vault(JSON.parse(JSON.stringify(v.toJSON())));
  assert.deepEqual(v2.entries(), [[s, "k1"]]);
  assert.equal(v2.standInFor("k2", "API_KEY", "token"), "[API_KEY_2]");
});
