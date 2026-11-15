import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { redactPdf, hiddenText } from "../src/docs/pdf.js";
import { findRedactions } from "../src/engine/redact.js";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";
import { Vault } from "../src/engine/vault.js";

const TINY_JPG = new Uint8Array(readFileSync(new URL("./fixtures/tiny.jpg", import.meta.url)));

function realRedactSpans() {
  const vault = new Vault();
  return async (texts) => texts.map((t) => findRedactions(t, PATTERN_DETECTORS, vault));
}

function stubRenderer() {
  const paints = [];
  const render = async (_page, _viewport, p) => {
    paints.push(...p);
    return TINY_JPG;
  };
  return { render, paints };
}

async function makePdf(lines, { pages = 1, size = [612, 792], title } = {}) {
  const doc = await PDFDocument.create();
  if (title) {
    doc.setTitle(title);
    doc.setAuthor("Jane Real");
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    lines.forEach((line, j) => page.drawText(line, { x: 72, y: 700 - 20 * j, size: 12, font }));
  }
  return doc.save();
}

async function extractText(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out += tc.items.map((it) => it.str).join(" ") + "\n";
  }
  return out;
}

test("redacted PDF: stand-ins in extracted text, originals gone, page size kept", async () => {
  const input = await makePdf(["Contact jane@corp.io", "key AKIAIOSFODNN7EXAMPLE"], { title: "Secret plan" });
  const { render, paints } = stubRenderer();
  const out = await redactPdf(input, realRedactSpans(), { pdfjs, render });

  assert.equal(out.count, 2);
  const text = await extractText(out.bytes);
  assert.match(text, /[a-z]+\.[a-z]+@example\.com/);
  assert.match(text, /\[API_KEY_1\]/);
  assert.ok(!text.includes("jane@corp.io"));
  assert.ok(!text.includes("AKIAIOSFODNN7EXAMPLE"));

  const doc = await PDFDocument.load(out.bytes);
  const { width, height } = doc.getPage(0).getSize();
  assert.deepEqual([width, height], [612, 792]);
  assert.equal(doc.getTitle(), undefined);
  assert.equal(doc.getAuthor(), undefined);
  assert.equal(doc.getPage(0).node.Annots()?.size() ?? 0, 0);

  assert.deepEqual(paints.map((p) => p.standIn).filter(Boolean).sort(), ["[API_KEY_1]", paints.find((p) => p.standIn.includes("@"))?.standIn].sort());
  for (const p of paints) assert.ok(p.w > 0 && p.h > 0 && p.fontPx > 0);
});

test("paint boxes are in canvas space at scale 2", async () => {
  const input = await makePdf(["key AKIAIOSFODNN7EXAMPLE"]);
  const { render, paints } = stubRenderer();
  await redactPdf(input, realRedactSpans(), { pdfjs, render });
  const [p] = paints;
  // text at pdf (72+, 700) on a 792pt page → canvas y ≈ (792-700-12)*2 = 160
  assert.ok(p.x > 144 && p.x < 1224, `x=${p.x}`);
  assert.ok(Math.abs(p.y - 160) < 8, `y=${p.y}`);
  assert.ok(Math.abs(p.h - 24) < 4, `h=${p.h}`);
});

test("clean PDF: count 0, still rebuilt", async () => {
  const input = await makePdf(["hello world"]);
  const out = await redactPdf(input, realRedactSpans(), { pdfjs, render: stubRenderer().render });
  assert.equal(out.count, 0);
  assert.match(await extractText(out.bytes), /hello world/);
});

test("image-only PDF → no-text with original bytes", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawImage(await doc.embedJpg(TINY_JPG), { x: 0, y: 0, width: 200, height: 200 });
  const input = await doc.save();
  const out = await redactPdf(input, realRedactSpans(), { pdfjs, render: stubRenderer().render });
  assert.equal(out.status, "no-text");
  assert.equal(out.bytes, input);
});

test("more than 100 pages rejects", async () => {
  const input = await makePdf(["x"], { pages: 101, size: [50, 50] });
  await assert.rejects(redactPdf(input, realRedactSpans(), { pdfjs, render: stubRenderer().render }), /100 pages/);
});

test("hiddenText replaces characters Helvetica cannot encode", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  assert.equal(hiddenText("café 你好 x@example.com", font), "café ?? x@example.com");
});

test("input bytes are not detached or modified", async () => {
  const input = await makePdf(["key AKIAIOSFODNN7EXAMPLE"]);
  const copy = input.slice();
  await redactPdf(input, realRedactSpans(), { pdfjs, render: stubRenderer().render });
  assert.deepEqual(input, copy);
});
