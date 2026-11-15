import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreSpansFor } from "../src/docs/restore-spans.js";
import { isRestorableFile } from "../src/main/file-response.js";
import { redactPdf } from "../src/docs/pdf.js";
import { redactFile } from "../src/docs/router.js";
import { redactText } from "../src/docs/text.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

const FAKE = "AKIAQ3M8XZ1LP0VW7RTE";
const REAL = "AKIAIOSFODNN7EXAMPLE";
const entries = [[FAKE, REAL], ["mike.ray@kpla.io", "jane@corp.io"]];

test("restoreSpansFor finds stand-ins and maps them to originals", () => {
  assert.deepEqual(restoreSpansFor([`key ${FAKE} and mike.ray@kpla.io`, "clean"], entries), [
    [
      { start: 4, end: 24, standIn: REAL },
      { start: 29, end: 45, standIn: "jane@corp.io" },
    ],
    [],
  ]);
});

test("restoreSpansFor prefers the longest stand-in", () => {
  assert.deepEqual(restoreSpansFor(["[CARD_10]"], [["[CARD_1]", "one"], ["[CARD_10]", "ten"]]), [[{ start: 0, end: 9, standIn: "ten" }]]);
});

test("text files are restored through the normal handler", async () => {
  const bytes = new TextEncoder().encode(`key=${FAKE}`);
  const out = await redactText(bytes, async (texts) => restoreSpansFor(texts, entries));
  assert.equal(new TextDecoder().decode(out.bytes), `key=${REAL}`);
});

test("clean files come back untouched (no rebuild)", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]).drawText("nothing to see", { x: 10, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  const input = await doc.save();
  const out = await redactFile({ name: "a.pdf", type: "application/pdf", bytes: input }, async (t) => restoreSpansFor(t, entries), {
    pdf: (b, s) => redactPdf(b, s, { pdfjs, render: async () => new Uint8Array(readFileSync(new URL("./fixtures/tiny.jpg", import.meta.url))), skipIfClean: true }),
  });
  assert.equal(out.status, "clean");
  assert.equal(out.bytes, input);
});

test("generated PDF with a stand-in is rebuilt with the original", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 200]).drawText(`key ${FAKE}`, { x: 10, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  const out = await redactPdf(await doc.save(), async (t) => restoreSpansFor(t, entries), {
    pdfjs,
    render: async () => new Uint8Array(readFileSync(new URL("./fixtures/tiny.jpg", import.meta.url))),
    skipIfClean: true,
  });
  const pdf = await pdfjs.getDocument({ data: out.bytes.slice(), verbosity: 0 }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(" ");
  assert.match(text, new RegExp(REAL));
  assert.ok(!text.includes(FAKE));
});

test("isRestorableFile: by content-type and disposition", () => {
  const h = (o) => new Headers(o);
  assert.equal(isRestorableFile(h({ "content-type": "application/pdf" })), "pdf");
  assert.equal(isRestorableFile(h({ "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })), "docx");
  assert.equal(isRestorableFile(h({ "content-type": "text/csv", "content-disposition": 'attachment; filename="a.csv"' })), "text");
  assert.equal(isRestorableFile(h({ "content-type": "application/json" })), null, "API JSON untouched");
  assert.equal(isRestorableFile(h({ "content-type": "text/plain" })), null, "text without a filename untouched");
  assert.equal(isRestorableFile(h({ "content-type": "text/event-stream", "content-disposition": "inline; filename=x" })), null, "streams untouched");
});

import { installFileRestorer } from "../src/main/file-response.js";

function fakeWin(response) {
  return { fetch: async () => response };
}

test("file responses are replaced with restored bytes; headers kept, length dropped", async () => {
  const win = fakeWin(new Response("key FAKE", { headers: { "content-type": "application/pdf", "content-length": "8", "x-a": "1" } }));
  installFileRestorer({ win, restore: async ({ kind, buffer }) => (assert.equal(kind, "pdf"), new TextEncoder().encode(new TextDecoder().decode(buffer).replace("FAKE", "REAL!"))) });
  const res = await win.fetch("https://claude.ai/files/x");
  assert.equal(await res.text(), "key REAL!");
  assert.equal(res.headers.get("x-a"), "1");
  assert.equal(res.headers.get("content-length"), null);
  assert.equal(res.status, 200);
});

test("non-file responses pass through untouched", async () => {
  const original = new Response("{}", { headers: { "content-type": "application/json" } });
  const win = fakeWin(original);
  installFileRestorer({ win, restore: async () => assert.fail("not called") });
  assert.equal(await win.fetch("x"), original);
});

test("restore returning null (nothing to restore) → original response", async () => {
  const original = new Response("x", { headers: { "content-type": "application/pdf" } });
  const win = fakeWin(original);
  installFileRestorer({ win, restore: async () => null });
  const res = await win.fetch("x");
  assert.equal(await res.text(), "x");
});

test("restore failing → original response (fail open)", async () => {
  const win = fakeWin(new Response("x", { headers: { "content-type": "application/pdf" } }));
  installFileRestorer({ win, restore: async () => { throw new Error("boom"); } });
  assert.equal(await (await win.fetch("x")).text(), "x");
});

test("error responses are not touched", async () => {
  const original = new Response("nope", { status: 404, headers: { "content-type": "application/pdf" } });
  const win = fakeWin(original);
  installFileRestorer({ win, restore: async () => assert.fail("not called") });
  assert.equal(await win.fetch("x"), original);
});
