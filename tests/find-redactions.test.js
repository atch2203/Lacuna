import { test } from "node:test";
import assert from "node:assert/strict";
import { findRedactions, redact } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { Vault } from "../src/engine/vault.js";

test("findRedactions returns spans with same-length stand-ins", () => {
  const v = new Vault();
  const [span, ...rest] = findRedactions("key AKIAIOSFODNN7EXAMPLE x", PATTERN_DETECTORS, v);
  assert.equal(rest.length, 0);
  assert.deepEqual([span.start, span.end], [4, 24]);
  assert.equal(span.standIn.length, 20);
  assert.ok(span.standIn.startsWith("AKIA"));
});

test("a known fake in the text is not redacted again", () => {
  const v = new Vault();
  const [{ standIn }] = findRedactions("AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v);
  assert.deepEqual(findRedactions(`pasted back: ${standIn}`, PATTERN_DETECTORS, v), []);
});

test("findRedactions on clean text → []", () => {
  assert.deepEqual(findRedactions("hello", PATTERN_DETECTORS, new Vault()), []);
});

test("document and prompt share stand-ins via the vault", () => {
  const v = new Vault();
  const [span] = findRedactions("doc: AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v);
  assert.equal(redact("prompt AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v), `prompt ${span.standIn}`);
});
