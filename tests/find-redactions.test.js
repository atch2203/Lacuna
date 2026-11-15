import { test } from "node:test";
import assert from "node:assert/strict";
import { findRedactions, redact } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { Vault } from "../src/engine/vault.js";

test("findRedactions returns spans with stand-ins", () => {
  const v = new Vault();
  assert.deepEqual(findRedactions("key AKIAIOSFODNN7EXAMPLE x", PATTERN_DETECTORS, v), [
    { start: 4, end: 24, standIn: "[API_KEY_1]" },
  ]);
});

test("findRedactions on clean text → []", () => {
  assert.deepEqual(findRedactions("hello", PATTERN_DETECTORS, new Vault()), []);
});

test("document and prompt share stand-ins via the vault", () => {
  const v = new Vault();
  const [span] = findRedactions("doc: AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v);
  assert.equal(redact("prompt AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v), `prompt ${span.standIn}`);
});
