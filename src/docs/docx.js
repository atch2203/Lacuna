// DOCX redaction: edit text inside the package's XML, keeping run formatting.
//
// Word splits text into runs (<w:r><w:t>…</w:t></w:r>) at formatting
// boundaries, so one value can span several <w:t> nodes. Each paragraph's
// run text is concatenated, redacted as one string, then mapped back.
//
// Every XML part is processed, not just the body, because originals also
// live in tracked deletions (w:delText), field codes (w:instrText,
// w:fldSimple/@w:instr), hyperlink targets (*.rels), authors, alt text,
// people.xml, document properties and customXml.
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { applySpans } from "./router.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

// <w:*> elements whose text is grouped per paragraph and run-split.
const RUN_TEXT = ["t", "delText", "instrText", "delInstrText"];
// Attributes (by local name) that can carry people's data.
const PII_ATTRS = new Set(["instr", "descr", "title", "author", "userId", "initials"]);

const PART_ORDER = [
  /^word\/document\.xml$/,
  /^word\/header\d*\.xml$/,
  /^word\/footer\d*\.xml$/,
  /^word\/footnotes\.xml$/,
  /^word\/endnotes\.xml$/,
  /^word\/comments\.xml$/,
];

function partRank(name) {
  const i = PART_ORDER.findIndex((re) => re.test(name));
  return i < 0 ? PART_ORDER.length : i;
}

// nodeTexts: texts of one paragraph's run-text nodes, in order.
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

function elements(doc) {
  const all = doc.getElementsByTagName("*");
  const out = [];
  for (let i = 0; i < all.length; i++) out.push(all[i]);
  return out;
}

function hasElementChildren(el) {
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) return true;
  return false;
}

// Units of redactable text in one parsed part:
//   { kind: "runs", nodes }        run-text nodes of one paragraph (one kind)
//   { kind: "attr", el, attr }     one attribute value
// Leaf elements with other text become single-node "runs" units.
function unitsOf(doc, partName) {
  const units = [];
  const els = elements(doc);

  for (const local of RUN_TEXT) {
    const groups = new Map();
    for (const el of els) {
      if (el.namespaceURI !== W_NS || el.localName !== local) continue;
      const p = enclosingParagraph(el);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    }
    for (const nodes of groups.values()) units.push({ kind: "runs", nodes, wordRun: true });
  }

  for (const el of els) {
    const isRunText = el.namespaceURI === W_NS && RUN_TEXT.includes(el.localName);
    if (!isRunText && !hasElementChildren(el) && el.textContent.trim()) {
      units.push({ kind: "runs", nodes: [el], wordRun: false });
    }
  }

  const isRels = partName.endsWith(".rels");
  for (const el of els) {
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const local = attr.localName ?? attr.name;
      if (PII_ATTRS.has(local)) units.push({ kind: "attr", el, attr });
      if (isRels && local === "Target") {
        const external = el.getAttribute("TargetMode") === "External" || /^(mailto|tel):/i.test(attr.value);
        if (external) units.push({ kind: "attr", el, attr });
      }
    }
  }
  return units;
}

function unitText(unit) {
  return unit.kind === "attr" ? unit.attr.value : unit.nodes.map((n) => n.textContent).join("");
}

export async function redactDocx(bytes, redactSpans) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir && /\.(xml|rels)$/i.test(n))
    .sort((a, b) => partRank(a) - partRank(b) || a.localeCompare(b));

  const parts = [];
  const units = [];
  for (const name of names) {
    let doc;
    try {
      doc = new DOMParser({ onError: () => {} }).parseFromString(await zip.file(name).async("string"), "text/xml");
    } catch {
      continue;
    }
    if (!doc?.documentElement) continue;
    const part = { name, doc, changed: false };
    parts.push(part);
    for (const unit of unitsOf(doc, name)) units.push({ ...unit, part });
  }

  const allSpans = await redactSpans(units.map(unitText));

  let count = 0;
  units.forEach((unit, i) => {
    const spans = allSpans[i];
    if (!spans.length) return;
    count += spans.length;
    unit.part.changed = true;
    if (unit.kind === "attr") {
      unit.el.setAttribute(unit.attr.name, applySpans(unit.attr.value, spans));
      return;
    }
    const rewritten = rewriteRuns(
      unit.nodes.map((n) => n.textContent),
      spans,
    );
    unit.nodes.forEach((node, j) => {
      if (rewritten[j] === node.textContent) return;
      setText(unit.part.doc, node, rewritten[j]);
      if (unit.wordRun) node.setAttributeNS(XML_NS, "xml:space", "preserve");
    });
  });

  for (const part of parts) {
    if (part.changed) zip.file(part.name, new XMLSerializer().serializeToString(part.doc));
  }

  const warnings = [];
  const embedded = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /^word\/embeddings\//.test(n)).length;
  if (embedded) warnings.push(`contains ${embedded} embedded object${embedded === 1 ? "" : "s"} that ${embedded === 1 ? "was" : "were"} not redacted`);

  return { bytes: await zip.generateAsync({ type: "uint8array" }), count, warnings };
}
