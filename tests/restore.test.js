import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRestorer } from "../src/engine/restore.js";

test("restores multiple stand-ins", () => {
  const r = makeRestorer([["[API_KEY_1]", "AKIAX"], ["Jordan Lee", "Ann Real"]]);
  assert.equal(r("Jordan Lee owns [API_KEY_1]."), "Ann Real owns AKIAX.");
});

test("prefix stand-ins: longest first", () => {
  const r = makeRestorer([["[CARD_1]", "one"], ["[CARD_10]", "ten"]]);
  assert.equal(r("[CARD_10] [CARD_1]"), "ten one");
});

test("regex chars in stand-ins are literal", () => {
  assert.equal(makeRestorer([["[IP_1]", "10.0.0.1"]])("I1 [IP_1]"), "I1 10.0.0.1");
});

test("empty entries → identity", () => {
  assert.equal(makeRestorer([])("[X_1] text"), "[X_1] text");
});

test("originals containing $ are inserted literally", () => {
  assert.equal(makeRestorer([["[SECRET_1]", "pa$&ss"]])("pw [SECRET_1]"), "pw pa$&ss");
});
