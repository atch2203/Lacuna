import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeLike, seededRng } from "../src/engine/fakes.js";
import { PATTERN_DETECTORS, luhnValid } from "../src/engine/patterns.js";

const detect = (id, s) => PATTERN_DETECTORS.find((d) => d.id === id).find(s).some((sp) => sp.start === 0 && sp.end === s.length);
const many = (category, original, n = 30) => {
  const rng = seededRng(42);
  return Array.from({ length: n }, () => fakeLike(category, original, rng));
};

const CASES = [
  ["API_KEY", "AKIAIOSFODNN7EXAMPLE", "api_key"],
  ["API_KEY", "sk-ant-api03-abcdefghij1234567890XYZ", "api_key"],
  ["API_KEY", "ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "api_key"],
  ["API_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "api_key"],
  ["IP", "10.20.30.40", "ip"],
  ["IP", "192.168.1.200", "ip"],
  ["IP", "2001:db8::1", "ip"],
  ["CARD", "4111 1111 1111 1111", "card"],
  ["CARD", "3782 822463 10005", "card"],
  ["SSN", "123-45-6789", "ssn"],
  ["PHONE", "(413) 555-8812", "phone"],
  ["PHONE", "+1 413-555-8812", "phone"],
  ["EMAIL", "jane.doe@acme-corp.io", "email"],
  ["EMAIL", "x@y.co", "email"],
];

for (const [category, original, detectorId] of CASES) {
  test(`${category} fake for ${original.slice(0, 20)}: same length, still detected, different`, () => {
    for (const fake of many(category, original)) {
      assert.equal(fake.length, original.length, fake);
      assert.notEqual(fake, original);
      assert.ok(detect(detectorId, fake), `${fake} not detected as ${detectorId}`);
    }
  });
}

test("AWS key keeps its AKIA prefix; sk-ant keeps its prefix", () => {
  assert.ok(many("API_KEY", "AKIAIOSFODNN7EXAMPLE").every((f) => f.startsWith("AKIA")));
  assert.ok(many("API_KEY", "sk-ant-api03-abcdefghij1234567890XYZ").every((f) => f.startsWith("sk-ant-")));
});

test("card fakes keep grouping and pass Luhn", () => {
  for (const f of many("CARD", "4111-1111-1111-1111")) {
    assert.match(f, /^\d{4}-\d{4}-\d{4}-\d{4}$/);
    assert.ok(luhnValid(f.replace(/-/g, "")));
  }
});

test("private key block keeps header/footer and line structure", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----";
  for (const f of many("PRIVATE_KEY", pem, 5)) {
    assert.equal(f.length, pem.length);
    assert.ok(f.startsWith("-----BEGIN RSA PRIVATE KEY-----\n") && f.endsWith("\n-----END RSA PRIVATE KEY-----"));
    assert.notEqual(f, pem);
  }
});

test("secrets and url tokens keep character classes", () => {
  for (const f of many("SECRET", "hunter2!")) {
    assert.match(f, /^[a-z]{6}\d!$/);
  }
});

test("names: same length, same capitalization and spaces", () => {
  for (const f of many("PERSON", "Ann Real")) {
    assert.equal(f.length, 8);
    assert.match(f, /^[A-Z][a-z]{2} [A-Z][a-z]{3}$/);
  }
  for (const f of many("OTHER", "Project Falcon")) {
    assert.match(f, /^[A-Z][a-z]{6} [A-Z][a-z]{5}$/);
  }
});

test("seeded rng is deterministic", () => {
  assert.equal(fakeLike("IP", "10.20.30.40", seededRng(7)), fakeLike("IP", "10.20.30.40", seededRng(7)));
});

test("short email locals use a real-looking name", () => {
  const rng = seededRng(3);
  assert.match(fakeLike("EMAIL", "jane@corp.io", rng), /^(jordan|riley|casey|morgan|avery|quinn|taylor|skyler|rowan|emerson|parker|reese|hayden|dakota|kendall|sage|finley|harper|logan|peyton|cameron|drew|elliot|jamie|kai|lane|marlowe|noel|oakley|remy|lee|rivera|brooks|hayes|ellis|foster|grant|hollis|irving|jensen|keller|lowell|mercer|nash|orton|pryor|quill|ramsey|sutton|thorne|underhill|vance|whitlock|yardley|abbott|barlow|calloway|dempsey|easton|fairley)@[a-z]{4}\.io$/);
});
