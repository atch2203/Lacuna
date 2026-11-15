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

test("stand-ins are realistic fakes with the original's length", () => {
  const v = new Vault();
  const key = v.standInFor("AKIAIOSFODNN7EXAMPLE", "API_KEY", "token");
  assert.equal(key.length, 20);
  assert.ok(key.startsWith("AKIA") && key !== "AKIAIOSFODNN7EXAMPLE");
  assert.match(v.standInFor("10.20.30.40", "IP", "token"), /^\d{2}\.\d{2}\.\d{2}\.\d{2}$/);
});

test("distinct originals get distinct fakes", () => {
  const v = new Vault();
  assert.notEqual(v.standInFor("10.20.30.40", "IP"), v.standInFor("10.20.30.41", "IP"));
});

test("fake email keeps length and TLD", () => {
  const f = new Vault().standInFor("jane.doe@corp.io", "EMAIL", "fake");
  assert.equal(f.length, 16);
  assert.match(f, /@[a-z]{4}\.io$/);
});

test("fake phone keeps format", () => {
  assert.match(new Vault().standInFor("413-555-8812", "PHONE", "fake"), /^\d{3}-\d{3}-\d{4}$/);
});

test("fake skips values rejected by avoid", () => {
  const v = new Vault();
  const seen = [];
  const s = v.standInFor("Alice Real", "PERSON", "fake", (c) => (seen.push(c), seen.length < 3));
  assert.equal(s, seen[2]);
});

test("fake never reuses an existing stand-in", () => {
  const v = new Vault();
  const a = v.standInFor("Alice Real", "PERSON", "fake");
  const b = v.standInFor("Bob Real", "PERSON", "fake");
  assert.notEqual(a, b);
});

test("round-trips through JSON", () => {
  const v = new Vault();
  const s = v.standInFor("AKIAIOSFODNN7EXAMPLE", "API_KEY", "token");
  const v2 = new Vault(JSON.parse(JSON.stringify(v.toJSON())));
  assert.deepEqual(v2.entries(), [[s, "AKIAIOSFODNN7EXAMPLE"]]);
  assert.equal(v2.standInFor("AKIAIOSFODNN7EXAMPLE", "API_KEY"), s);
});
