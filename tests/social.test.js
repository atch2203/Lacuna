import { test } from "node:test";
import assert from "node:assert/strict";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { fakeLike, seededRng } from "../src/engine/fakes.js";
import { redact } from "../src/engine/redact.js";
import { Vault } from "../src/engine/vault.js";
import { makeRestorer } from "../src/engine/restore.js";

const hits = (text) => {
  const d = PATTERN_DETECTORS.find((x) => x.id === "handle");
  return d.find(text).map((s) => text.slice(s.start, s.end));
};

test("profile links: username part only", () => {
  assert.deepEqual(hits("see https://x.com/barrybonds25 now"), ["barrybonds25"]);
  assert.deepEqual(hits("twitter.com/Barry_Bonds"), ["Barry_Bonds"]);
  assert.deepEqual(hits("https://www.instagram.com/barry.bonds/"), ["barry.bonds"]);
  assert.deepEqual(hits("https://github.com/atch2203/repo"), ["atch2203"]);
  assert.deepEqual(hits("https://www.linkedin.com/in/barry-bonds-123/"), ["barry-bonds-123"]);
  assert.deepEqual(hits("https://www.tiktok.com/@barry25"), ["barry25"]);
  assert.deepEqual(hits("https://youtube.com/@BarryBonds"), ["BarryBonds"]);
  assert.deepEqual(hits("https://www.reddit.com/u/barry25 and /user/bonds"), ["barry25"]);
  assert.deepEqual(hits("https://bsky.app/profile/barry.bsky.social"), ["barry.bsky.social"]);
  assert.deepEqual(hits("https://www.threads.net/@barry25"), ["barry25"]);
  assert.deepEqual(hits("https://facebook.com/barry.bonds.5"), ["barry.bonds.5"]);
});

test("platform pages that aren't profiles are left alone", () => {
  assert.deepEqual(hits("https://x.com/home https://x.com/explore https://github.com/features https://www.instagram.com/p/abc https://github.com/settings"), []);
});

test("bare handles in prose", () => {
  assert.deepEqual(hits("thanks @barrybonds25!"), ["@barrybonds25"]);
  assert.deepEqual(hits("@barry_bonds said hi"), ["@barry_bonds"]);
  assert.deepEqual(hits("cc (@jane.doe) and @bob."), ["@jane.doe", "@bob"]);
});

test("code and emails are not handles", () => {
  for (const s of [
    "@media (max-width: 600px) {",
    "@import url(x.css);",
    "/** @param name the name */",
    "@Override\npublic void run()",
    "npm i @types/node",
    "mail jane@corp.io",
    "@decorator()",
    "@Component({ selector: 'x' })",
    "x @ y",
    "a@b",
  ]) {
    assert.deepEqual(hits(s), [], s);
  }
});

test("handle fakes keep @, length, separators and digit positions", () => {
  const rng = seededRng(5);
  for (let i = 0; i < 20; i++) {
    const f = fakeLike("HANDLE", "@barry_bonds25", rng);
    assert.match(f, /^@[a-z]{5}_[a-z]{5}\d\d$/);
    assert.notEqual(f, "@barry_bonds25");
  }
  assert.match(fakeLike("HANDLE", "Barry.Bonds", seededRng(1)), /^[A-Z][a-z]{4}\.[A-Z][a-z]{4}$/);
});

test("link username and bare handle redact and restore", () => {
  const v = new Vault();
  const input = "follow @barrybonds25 at https://x.com/barrybonds25";
  const out = redact(input, PATTERN_DETECTORS, v);
  assert.ok(!out.includes("barrybonds25"), out);
  assert.equal(out.length, input.length);
  assert.equal(makeRestorer(v.entries())(out), input);
});

test("handles restore even if the model changes their case", () => {
  const r = makeRestorer([["@kelorinax41", "@barrybonds25"]]);
  assert.equal(r("Ask @Kelorinax41."), "Ask @barrybonds25.");
});
