import { test } from "node:test";
import assert from "node:assert/strict";
import { PATTERN_DETECTORS, luhnValid } from "../src/engine/patterns.js";

function hits(id, text) {
  const d = PATTERN_DETECTORS.find((x) => x.id === id);
  assert.ok(d, `detector ${id} exists`);
  return d.find(text).map((s) => text.slice(s.start, s.end));
}

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const PEM_PRIV =
  "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----";
const PEM_PUB =
  "-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf\n-----END PUBLIC KEY-----";

test("luhnValid", () => {
  assert.equal(luhnValid("4111111111111111"), true);
  assert.equal(luhnValid("4111111111111112"), false);
});

test("email", () => {
  assert.deepEqual(hits("email", "mail jane.doe+x@corp.co.uk now"), ["jane.doe+x@corp.co.uk"]);
  assert.deepEqual(hits("email", "foo@bar"), []);
});

test("phone", () => {
  assert.deepEqual(hits("phone", "call (413) 555-8812 today"), ["(413) 555-8812"]);
  assert.deepEqual(hits("phone", "call +1 413-555-8812"), ["+1 413-555-8812"]);
  assert.deepEqual(hits("phone", "on 2024-11-14"), []);
});

test("ssn", () => {
  assert.deepEqual(hits("ssn", "ssn 123-45-6789"), ["123-45-6789"]);
  assert.deepEqual(hits("ssn", "000-12-3456 666-12-3456 123-00-6789"), []);
});

test("card", () => {
  assert.deepEqual(hits("card", "card 4111 1111 1111 1111."), ["4111 1111 1111 1111"]);
  assert.deepEqual(hits("card", "card 4111-1111-1111-1111"), ["4111-1111-1111-1111"]);
  assert.deepEqual(hits("card", "card 4111 1111 1111 1112"), []);
});

test("ip", () => {
  assert.deepEqual(hits("ip", "host 192.168.1.20 up"), ["192.168.1.20"]);
  assert.deepEqual(hits("ip", "v6 2001:db8::1 up"), ["2001:db8::1"]);
  assert.deepEqual(hits("ip", "999.1.1.1 and 1.2.3"), []);
});

test("api_key", () => {
  assert.deepEqual(hits("api_key", "AKIAIOSFODNN7EXAMPLE"), ["AKIAIOSFODNN7EXAMPLE"]);
  assert.deepEqual(hits("api_key", "k=sk-ant-api03-abcdefghij1234567890XYZ"), ["sk-ant-api03-abcdefghij1234567890XYZ"]);
  const ghp = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
  assert.deepEqual(hits("api_key", `token ${ghp}`), [ghp]);
  assert.deepEqual(hits("api_key", `auth ${JWT}`), [JWT]);
  assert.deepEqual(hits("api_key", "sk- and ask-me"), []);
});

test("private_key", () => {
  assert.deepEqual(hits("private_key", `x\n${PEM_PRIV}\ny`), [PEM_PRIV]);
  assert.deepEqual(hits("private_key", PEM_PUB), []);
});

test("secret value only", () => {
  assert.deepEqual(hits("secret", "password=hunter2"), ["hunter2"]);
  assert.deepEqual(hits("secret", 'api_secret: "s3cr3t"'), ["s3cr3t"]);
  assert.deepEqual(hits("secret", "what is a password"), []);
});

test("url_token value only", () => {
  assert.deepEqual(hits("url_token", "https://x.com/a?token=abc123&q=1"), ["abc123"]);
  assert.deepEqual(hits("url_token", "https://x.com/a?q=1"), []);
});

test("styles and categories", () => {
  const byId = Object.fromEntries(PATTERN_DETECTORS.map((d) => [d.id, d]));
  assert.equal(byId.email.style, "fake");
  assert.equal(byId.phone.style, "fake");
  assert.equal(byId.card.style, "token");
  assert.equal(byId.url_token.category, "URL_TOKEN");
});

test("url_token finds every token param in a URL", () => {
  const t = "https://x.com/a?sig=AAA&q=1&token=BBB";
  assert.deepEqual(hits("url_token", t), ["AAA", "BBB"]);
});
