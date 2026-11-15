import { test } from "node:test";
import assert from "node:assert/strict";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { redact } from "../src/engine/redact.js";
import { Vault } from "../src/engine/vault.js";

const r = (text) => redact(text, PATTERN_DETECTORS, new Vault());

// C1
test("large paste (10k lines, 20k spans) redacts in under 1s", () => {
  const lines = [];
  for (let i = 0; i < 10000; i++) lines.push(`10.0.${i >> 8}.${i & 255} - user${i}@corp.io GET /`);
  const t0 = performance.now();
  const out = r(lines.join("\n"));
  const ms = performance.now() - t0;
  assert.ok(!out.includes("@corp.io"));
  assert.ok(ms < 1000, `took ${ms}ms`);
});

// I1 — false positives that corrupt normal prompts
for (const s of ["s[::-1]", "a[1::2]", "f :: Int -> Int", "x = 12:30:45"]) {
  test(`ipv6 does not match ${JSON.stringify(s)}`, () => assert.equal(r(s), s));
}
test("ipv6 still matches real addresses", () => assert.equal(r("host 2001:db8::1 up"), "host [IP_1] up"));

for (const s of ["q1\t450\t320\t1200", "rows: 100 200 3000", "1 450 320 1200"]) {
  test(`phone does not match ${JSON.stringify(s)}`, () => assert.equal(r(s), s));
}

for (const s of [
  "function f(token: string) {}",
  "const token = await getToken()",
  "pwd = os.getcwd()",
  "password: None",
  "api_key = process.env.API_KEY",
]) {
  test(`secret does not match ${JSON.stringify(s)}`, () => assert.equal(r(s), s));
}
test('secret matches JSON "password": "hunter2"', () => {
  assert.equal(r('{"password": "hunter2"}'), '{"password": "[SECRET_1]"}');
});
test("secret still matches password=hunter2", () => assert.equal(r("password=hunter2"), "password=[SECRET_1]"));

for (const s of ["0 0 0 0 0 0 0 0 0 0 0 0 0", "ts 1700000000007", "id 1234567812345670"]) {
  test(`card does not match ${JSON.stringify(s)}`, () => assert.equal(r(s), s));
}
test("card still matches visa/amex", () => {
  assert.equal(r("4111 1111 1111 1111"), "[CARD_1]");
  assert.equal(r("3782 822463 10005"), "[CARD_1]");
});

// I3
test("clearing the vault keeps counters so old stand-ins are never reissued", () => {
  const v = new Vault();
  v.standInFor("4111111111111111", "CARD", "token");
  const cleared = v.cleared();
  assert.deepEqual(cleared.entries(), []);
  assert.equal(cleared.standInFor("5555555555554444", "CARD", "token"), "[CARD_2]");
});

// I2
import { serialize } from "../src/shared/serialize.js";
test("serialize runs async calls one at a time, in order", async () => {
  const log = [];
  const run = serialize(async (id, ms) => {
    log.push(`start ${id}`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`end ${id}`);
    return id;
  });
  const results = await Promise.all([run("a", 30), run("b", 1)]);
  assert.deepEqual(results, ["a", "b"]);
  assert.deepEqual(log, ["start a", "end a", "start b", "end b"]);
});
test("serialize keeps going after a rejected call", async () => {
  const run = serialize(async (x) => { if (x === 1) throw new Error("no"); return x; });
  await assert.rejects(run(1));
  assert.equal(await run(2), 2);
});
