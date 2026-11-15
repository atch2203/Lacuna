// Final-review findings C1 (originals outside <w:t>) and I7 (other PII parts).
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { redactDocx } from "../src/docs/docx.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const WP = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const W15 = 'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
const EMAIL = "alice@corp.com";
const STAND_IN = "x@example.com";

async function fakeRedactSpans(texts) {
  return texts.map((t) => {
    const spans = [];
    let i = t.indexOf(EMAIL);
    while (i >= 0) {
      spans.push({ start: i, end: i + EMAIL.length, standIn: STAND_IN });
      i = t.indexOf(EMAIL, i + EMAIL.length);
    }
    return spans;
  });
}

async function docxWith(files) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

async function partsOf(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const out = {};
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) out[name] = await zip.file(name).async("string");
  }
  return out;
}

function assertNoOriginal(parts) {
  for (const [name, content] of Object.entries(parts)) {
    assert.ok(!content.includes(EMAIL), `${name} still contains the original`);
  }
}

test("hyperlink targets, field codes, fldSimple and tracked deletions are redacted", async () => {
  const doc = `<?xml version="1.0"?><w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:${EMAIL}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${EMAIL}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:fldSimple w:instr=" HYPERLINK &quot;mailto:${EMAIL}&quot; "><w:r><w:t>mail me</w:t></w:r></w:fldSimple></w:p>
<w:p><w:del w:author="Bob"><w:r><w:delText>old contact ${EMAIL}</w:delText></w:r></w:del><w:hyperlink r:id="rId5"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>
</w:body></w:document>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="styles.xml"/><Relationship Id="rId5" Type="h" Target="mailto:${EMAIL}" TargetMode="External"/></Relationships>`;
  const out = await redactDocx(await docxWith({ "word/document.xml": doc, "word/_rels/document.xml.rels": rels }), fakeRedactSpans);
  const parts = await partsOf(out.bytes);
  assertNoOriginal(parts);
  assert.match(parts["word/_rels/document.xml.rels"], /Target="mailto:x@example\.com"/);
  assert.match(parts["word/_rels/document.xml.rels"], /Target="styles\.xml"/, "internal targets untouched");
  assert.match(parts["word/document.xml"], /old contact x@example\.com/);
});

test("authors, alt text, people.xml, app/custom props and customXml are redacted", async () => {
  const doc = `<?xml version="1.0"?><w:document ${W} ${WP}><w:body>
<w:p><w:ins w:author="${EMAIL}"><w:r><w:t>added</w:t></w:r></w:ins></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="photo sent by ${EMAIL}" title="${EMAIL}"/></wp:inline></w:drawing></w:r></w:p>
</w:body></w:document>`;
  const people = `<?xml version="1.0"?><w15:people ${W15}><w15:person w15:author="Alice"><w15:presenceInfo w15:providerId="AD" w15:userId="${EMAIL}"/></w15:person></w15:people>`;
  const app = `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>${EMAIL}</Company></Properties>`;
  const custom = `<?xml version="1.0"?><Properties xmlns="p" xmlns:vt="v"><property name="Owner"><vt:lpwstr>${EMAIL}</vt:lpwstr></property></Properties>`;
  const item = `<?xml version="1.0"?><root><owner>${EMAIL}</owner></root>`;
  const out = await redactDocx(
    await docxWith({
      "word/document.xml": doc,
      "word/people.xml": people,
      "docProps/app.xml": app,
      "docProps/custom.xml": custom,
      "customXml/item1.xml": item,
    }),
    fakeRedactSpans,
  );
  assertNoOriginal(await partsOf(out.bytes));
});

test("embedded objects produce a warning", async () => {
  const doc = `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", doc);
  zip.file("word/embeddings/oleObject1.bin", new Uint8Array([1, 2, 3]));
  const out = await redactDocx(await zip.generateAsync({ type: "uint8array" }), fakeRedactSpans);
  assert.ok(out.warnings?.some((w) => /1 embedded object/.test(w)), JSON.stringify(out.warnings));
});
