// Bug: a dictionary person "Jane Doe" wasn't redacted when only "Jane" or
// "Doe" appeared. Parts map to the matching part of the full name's fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDictionaryDetectors } from "../src/engine/dictionary.js";
import { redact } from "../src/engine/redact.js";
import { Vault } from "../src/engine/vault.js";
import { makeRestorer } from "../src/engine/restore.js";

const dets = () => makeDictionaryDetectors([{ term: "Jane Doe", category: "PERSON" }]);

test("first name alone is redacted, consistent with the full name", () => {
  const v = new Vault();
  const full = redact("Jane Doe called", dets(), v).split(" called")[0];
  const [first, last] = full.split(" ");
  assert.equal(redact("ask Jane", dets(), v), `ask ${first}`);
  assert.equal(redact("Doe said", dets(), v), `${last} said`);
});

test("parts alone before the full name still agree with it later", () => {
  const v = new Vault();
  const firstOnly = redact("Jane", dets(), v);
  const full = redact("Jane Doe", dets(), v);
  assert.equal(full.split(" ")[0], firstOnly);
});

test("parts restore to the original parts", () => {
  const v = new Vault();
  const out = redact("Jane Doe, then Jane, then Doe", dets(), v);
  assert.equal(makeRestorer(v.entries())(out), "Jane Doe, then Jane, then Doe");
});

test("parts are whole words only and single-letter parts are ignored", () => {
  const v = new Vault();
  assert.equal(redact("Janet Doebert", dets(), v), "Janet Doebert");
  const d = makeDictionaryDetectors([{ term: "J Smith", category: "PERSON" }]);
  assert.equal(redact("J was here", d, v), "J was here");
});

test("non-person terms don't split into parts", () => {
  const v = new Vault();
  const d = makeDictionaryDetectors([{ term: "Project Falcon", category: "OTHER" }]);
  assert.equal(redact("Falcon launched", d, v), "Falcon launched");
});
