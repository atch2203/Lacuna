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

// Bug: "barry bonds" → fake "reese grant"; the model wrote "Reese Grant",
// which the exact-case restorer left on screen.
test("restores a fake written in different case, using that case", () => {
  const r = makeRestorer([["reese grant", "barry bonds"]]);
  assert.equal(r("Ask Reese Grant."), "Ask Barry Bonds.");
  assert.equal(r("REESE GRANT!"), "BARRY BONDS!");
  assert.equal(r("reese grant"), "barry bonds");
});

test("an exact-case entry wins over a case-insensitive one", () => {
  const r = makeRestorer([["reese grant", "barry bonds"], ["Reese Grant", "Barry Bonds"]]);
  assert.equal(r("Reese Grant / reese grant"), "Barry Bonds / barry bonds");
});

test("letter-only fakes match whole words only", () => {
  const r = makeRestorer([["kai", "doe"]]);
  assert.equal(r("the kaiser met kai"), "the kaiser met doe");
});

test("keys still restore exactly", () => {
  const r = makeRestorer([["AKIAQ3M8XZ1LP0VW7RTE", "AKIAIOSFODNN7EXAMPLE"]]);
  assert.equal(r("k=AKIAQ3M8XZ1LP0VW7RTE"), "k=AKIAIOSFODNN7EXAMPLE");
});

test("standInsIn counts case-insensitive name matches", () => {
  assert.deepEqual(makeRestorer([["reese grant", "barry bonds"]]).standInsIn("Reese Grant and reese grant").length, 2);
});
