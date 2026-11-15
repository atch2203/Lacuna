// DOCX redaction: edit text inside the package's XML, keeping run formatting.
//
// Word splits text into runs (<w:r><w:t>…</w:t></w:r>) at formatting
// boundaries, so one value can span several <w:t> nodes. Each paragraph's
// <w:t> texts are concatenated, redacted as one string, then mapped back.
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const WORD_PARTS = [
  /^word\/document\.xml$/,
  /^word\/header\d*\.xml$/,
  /^word\/footer\d*\.xml$/,
  /^word\/footnotes\.xml$/,
  /^word\/endnotes\.xml$/,
  /^word\/comments\.xml$/,
];
const CORE_PART = "docProps/core.xml";

// nodeTexts: texts of one paragraph's <w:t> nodes, in order.
// spans: sorted, non-overlapping, over nodeTexts.join("").
// Returns new texts: each stand-in goes in the node where its span starts;
// covered characters are removed from every touched node.
export function rewriteRuns(nodeTexts, spans) {
  const text = nodeTexts.join("");
  let ns = 0;
  return nodeTexts.map((nodeText) => {
    const ne = ns + nodeText.length;
    let out = "";
    let pos = ns;
    for (const s of spans) {
      if (s.start >= ne || s.end <= ns) continue;
      out += text.slice(pos, Math.max(s.start, ns));
      if (s.start >= ns) out += s.standIn;
      pos = Math.min(s.end, ne);
    }
    out += text.slice(pos, ne);
    ns = ne;
    return out;
  });
}

function setText(doc, node, value) {
  while (node.firstChild) node.removeChild(node.firstChild);
  node.appendChild(doc.createTextNode(value));
}

function enclosingParagraph(node) {
  for (let n = node.parentNode; n; n = n.parentNode) {
    if (n.namespaceURI === W_NS && n.localName === "p") return n;
  }
  return null;
}

// "Paragraphs" of a word part: groups of <w:t> nodes by nearest <w:p>, so
// nested paragraphs (text boxes) aren't counted twice.
function wordParagraphs(doc) {
  const groups = new Map();
  const ts = doc.getElementsByTagNameNS(W_NS, "t");
  for (let i = 0; i < ts.length; i++) {
    const p = enclosingParagraph(ts[i]);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(ts[i]);
  }
  return [...groups.values()];
}

// core.xml: each leaf element with text is its own paragraph.
function coreParagraphs(doc) {
  const out = [];
  const children = doc.documentElement.childNodes;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el.nodeType === 1 && el.textContent) out.push([el]);
  }
  return out;
}

export async function redactDocx(bytes, redactSpans) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const wordNames = WORD_PARTS.flatMap((re) => names.filter((n) => re.test(n)).sort());
  const parts = [...wordNames.map((name) => ({ name, kind: "word" }))];
  if (zip.file(CORE_PART)) parts.push({ name: CORE_PART, kind: "core" });

  // Parse every part and collect paragraphs in document order.
  const paragraphs = [];
  for (const part of parts) {
    part.doc = new DOMParser().parseFromString(await zip.file(part.name).async("string"), "text/xml");
    for (const nodes of part.kind === "word" ? wordParagraphs(part.doc) : coreParagraphs(part.doc)) {
      paragraphs.push({ part, nodes });
    }
  }

  const texts = paragraphs.map(({ nodes }) => nodes.map((n) => n.textContent).join(""));
  const allSpans = await redactSpans(texts);

  let count = 0;
  paragraphs.forEach(({ part, nodes }, i) => {
    const spans = allSpans[i];
    if (!spans.length) return;
    count += spans.length;
    part.changed = true;
    const rewritten = rewriteRuns(
      nodes.map((n) => n.textContent),
      spans,
    );
    nodes.forEach((node, j) => {
      if (rewritten[j] === node.textContent) return;
      setText(part.doc, node, rewritten[j]);
      if (part.kind === "word") node.setAttributeNS(XML_NS, "xml:space", "preserve");
    });
  });

  for (const part of parts) {
    if (part.changed) zip.file(part.name, new XMLSerializer().serializeToString(part.doc));
  }
  return { bytes: await zip.generateAsync({ type: "uint8array" }), count };
}
