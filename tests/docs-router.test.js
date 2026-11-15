import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFile, redactFile, applySpans } from "../src/docs/router.js";
import { redactText } from "../src/docs/text.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const unreachable = async () => { throw new Error("should not be called"); };

test("classifyFile by MIME and extension", () => {
  assert.equal(classifyFile({ name: "report.PDF", type: "" }), "pdf");
  assert.equal(classifyFile({ name: "notes.docx", type: "" }), "docx");
  assert.equal(classifyFile({ name: "x", type: "text/csv" }), "text");
  assert.equal(classifyFile({ name: "x", type: "application/json" }), "text");
  assert.equal(classifyFile({ name: "main.rs", type: "" }), "text");
  assert.equal(classifyFile({ name: "photo.png", type: "image/png" }), null);
  assert.equal(classifyFile({ name: "a.pdf", type: "application/pdf" }), "pdf");
});

test("applySpans splices stand-ins", () => {
  assert.equal(applySpans("a XX b YY", [{ start: 2, end: 4, standIn: "1" }, { start: 7, end: 9, standIn: "2" }]), "a 1 b 2");
});

test("redactText", async () => {
  const out = await redactText(enc("mail jane@corp.io"), async (texts) => {
    assert.deepEqual(texts, ["mail jane@corp.io"]);
    return [[{ start: 5, end: 17, standIn: "x@example.com" }]];
  });
  assert.equal(dec(out.bytes), "mail x@example.com");
  assert.equal(out.count, 1);
});

test("redactFile: unsupported passes bytes through", async () => {
  const bytes = enc("png");
  const out = await redactFile({ name: "photo.png", type: "image/png", bytes }, unreachable, {});
  assert.equal(out.status, "unsupported");
  assert.equal(out.bytes, bytes);
  assert.equal(out.count, 0);
});

test("redactFile: over 50 MB rejects", async () => {
  const bytes = { length: 50 * 1024 * 1024 + 1 };
  await assert.rejects(redactFile({ name: "a.txt", type: "", bytes }, unreachable, {}), /50 MB/);
});

test("redactFile: routes to handler and reports redacted", async () => {
  const out = await redactFile({ name: "a.txt", type: "", bytes: enc("x") }, unreachable, {
    text: async () => ({ bytes: enc("y"), count: 2 }),
  });
  assert.deepEqual({ status: out.status, count: out.count, text: dec(out.bytes) }, { status: "redacted", count: 2, text: "y" });
});

test("redactFile: pdf handler may report no-text", async () => {
  const bytes = enc("%PDF");
  const out = await redactFile({ name: "scan.pdf", type: "", bytes }, unreachable, {
    pdf: async () => ({ status: "no-text", bytes, count: 0 }),
  });
  assert.equal(out.status, "no-text");
});

test("mixed drop: pdf + png keep order and statuses", async () => {
  const handlers = { pdf: async () => ({ bytes: enc("red"), count: 1 }) };
  const files = [
    { name: "a.pdf", type: "application/pdf", bytes: enc("%PDF") },
    { name: "b.png", type: "image/png", bytes: enc("png") },
  ];
  const out = await Promise.all(files.map((f) => redactFile(f, unreachable, handlers)));
  assert.deepEqual(out.map((o) => o.status), ["redacted", "unsupported"]);
});

test("redactFile passes handler warnings through", async () => {
  const out = await redactFile({ name: "a.docx", type: "", bytes: enc("x") }, unreachable, {
    docx: async () => ({ bytes: enc("y"), count: 0, warnings: ["contains 1 embedded object that was not redacted"] }),
  });
  assert.deepEqual(out.warnings, ["contains 1 embedded object that was not redacted"]);
});
