import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { rewriteRuns, redactDocx } from "../src/docs/docx.js";

test("span inside one run", () => {
  assert.deepEqual(rewriteRuns(["mail jane@corp.io now"], [{ start: 5, end: 17, standIn: "S" }]), ["mail S now"]);
});

test("span across three runs", () => {
  assert.deepEqual(rewriteRuns(["mail ja", "ne@co", "rp.io now"], [{ start: 5, end: 17, standIn: "S" }]), [
    "mail S",
    "",
    " now",
  ]);
});

test("two spans in one paragraph", () => {
  assert.deepEqual(
    rewriteRuns(["a X b", " Y c"], [
      { start: 2, end: 3, standIn: "1" },
      { start: 6, end: 7, standIn: "2" },
    ]),
    ["a 1 b", " 2 c"],
  );
});

test("span starting at a run boundary", () => {
  assert.deepEqual(rewriteRuns(["ab", "XY", "cd"], [{ start: 2, end: 4, standIn: "S" }]), ["ab", "S", "cd"]);
});

test("no spans → unchanged", () => {
  assert.deepEqual(rewriteRuns(["a", "b"], []), ["a", "b"]);
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const run = (t, bold) => `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
<w:p>${run("mail ja")}${run("ne@co", true)}${run("rp.io now")}</w:p>
<w:p>${run("nothing here")}</w:p>
</w:body></w:document>`;
const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}><w:p>${run("key AKIAIOSFODNN7EXAMPLE")}</w:p></w:hdr>`;
const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Jane Real</dc:creator><dc:title>Plan</dc:title></cp:coreProperties>`;
const STYLES = `<?xml version="1.0"?><w:styles ${W}><!-- keep me exactly --></w:styles>`;

async function sampleDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("word/document.xml", DOCUMENT);
  zip.file("word/header1.xml", HEADER);
  zip.file("word/styles.xml", STYLES);
  zip.file("docProps/core.xml", CORE);
  return zip.generateAsync({ type: "uint8array" });
}

// Finds fixed needles by indexOf, like a dictionary would.
const NEEDLES = { "jane@corp.io": "x@example.com", "AKIAIOSFODNN7EXAMPLE": "[API_KEY_1]", "Jane Real": "Jordan Lee" };
async function fakeRedactSpans(texts) {
  return texts.map((t) =>
    Object.entries(NEEDLES)
      .map(([needle, standIn]) => ({ start: t.indexOf(needle), end: t.indexOf(needle) + needle.length, standIn }))
      .filter((s) => s.start >= 0)
      .sort((a, b) => a.start - b.start),
  );
}

const textOf = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

test("redactDocx round-trip", async () => {
  const out = await redactDocx(await sampleDocx(), fakeRedactSpans);
  assert.equal(out.count, 3);
  const zip = await JSZip.loadAsync(out.bytes);

  const doc = await zip.file("word/document.xml").async("string");
  assert.match(textOf(doc), /mail x@example\.com now/);
  assert.ok(!doc.includes("jane@") && !doc.includes("ne@co") && !doc.includes("rp.io"));
  assert.match(doc, /<w:b\/>/, "formatting runs kept");

  const hdr = await zip.file("word/header1.xml").async("string");
  assert.equal(textOf(hdr), "key [API_KEY_1]");

  const core = await zip.file("docProps/core.xml").async("string");
  assert.match(core, /<dc:creator>Jordan Lee<\/dc:creator>/);
  assert.match(core, /<dc:title>Plan<\/dc:title>/);

  assert.equal(await zip.file("word/styles.xml").async("string"), STYLES);
});

test("redactDocx sends all paragraphs in one call, in document order", async () => {
  const calls = [];
  await redactDocx(await sampleDocx(), async (texts) => {
    calls.push(texts);
    return texts.map(() => []);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ["mail jane@corp.io now", "nothing here", "key AKIAIOSFODNN7EXAMPLE"]);
});
