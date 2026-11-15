import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDictionaryDetectors } from "../src/engine/dictionary.js";
import { redact, resolveOverlaps } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { Vault } from "../src/engine/vault.js";
import { fakeFor } from "../src/engine/fakes.js";

test("dictionary is case-insensitive, whole word", () => {
  const [d] = makeDictionaryDetectors([{ term: "Ann", category: "PERSON" }]);
  assert.equal(d.find("ann said hi").length, 1);
  assert.equal(d.find("Annual report").length, 0);
});

test("dictionary escapes regex chars", () => {
  const [d] = makeDictionaryDetectors([{ term: "c++ team", category: "OTHER" }]);
  assert.equal(d.find("the C++ team").length, 1);
});

test("dictionary styles: PERSON/ORG fake, OTHER token", () => {
  const ds = makeDictionaryDetectors([
    { term: "a", category: "PERSON" },
    { term: "b", category: "ORG" },
    { term: "c", category: "OTHER" },
  ]);
  assert.deepEqual(ds.map((d) => d.style), ["fake", "fake", "token"]);
  assert.equal(ds[0].id, "dict:a");
});

test("longest overlapping span wins", () => {
  const r = resolveOverlaps([
    { start: 0, end: 5 },
    { start: 2, end: 12 },
    { start: 20, end: 22 },
  ]);
  assert.deepEqual(r.map((s) => [s.start, s.end]), [[2, 12], [20, 22]]);
});

test("equal-length overlap: earliest wins", () => {
  const r = resolveOverlaps([
    { start: 3, end: 8 },
    { start: 1, end: 6 },
  ]);
  assert.deepEqual(r.map((s) => [s.start, s.end]), [[1, 6]]);
});

test("redact replaces all, consistent for repeats, same length", () => {
  const v = new Vault();
  const input = "key AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLE";
  const out = redact(input, PATTERN_DETECTORS, v);
  assert.equal(out.length, input.length);
  assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
  const fake = v.byOriginal.AKIAIOSFODNN7EXAMPLE;
  assert.equal(out, `key ${fake} and ${fake}`);
});

test("redact leaves clean text identical", () => {
  assert.equal(redact("hello world", PATTERN_DETECTORS, new Vault()), "hello world");
});

test("redact mixes dictionary and patterns", () => {
  const v = new Vault();
  const dets = [...PATTERN_DETECTORS, ...makeDictionaryDetectors([{ term: "Project Falcon", category: "OTHER" }])];
  const out = redact("Project Falcon key AKIAIOSFODNN7EXAMPLE", dets, v);
  assert.equal(out, `${v.byOriginal["Project Falcon"]} key ${v.byOriginal.AKIAIOSFODNN7EXAMPLE}`);
  assert.match(v.byOriginal["Project Falcon"], /^[A-Z][a-z]{6} [A-Z][a-z]{5}$/);
});



test("different originals get different fakes", () => {
  const v = new Vault();
  redact("AKIAAAAAAAAAAAAAAAAA then AKIABBBBBBBBBBBBBBBB", PATTERN_DETECTORS, v);
  assert.notEqual(v.byOriginal.AKIAAAAAAAAAAAAAAAAA, v.byOriginal.AKIABBBBBBBBBBBBBBBB);
});
