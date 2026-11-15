// Hidden extension-origin frame that redacts attached documents.
// Runs at chrome-extension:// so pdf.js gets a real worker and the frame can
// ask the service worker (vault owner) for stand-ins.
//
// Protocol (postMessage, source "llm-redactor-docframe"):
//   frame → parent  { type: "ready" }
//   parent → frame  { type: "redact", id, name, mime, buffer }   (buffer transferred)
//   frame → parent  { type: "result", id, status, count, buffer } | { type: "result", id, error }
import * as pdfjs from "pdfjs-dist";
import { redactFile } from "../docs/router.js";
import { redactText } from "../docs/text.js";
import { redactDocx } from "../docs/docx.js";
import { redactPdf } from "../docs/pdf.js";
import { renderPage } from "./render.js";

const SOURCE = "llm-redactor-docframe";
const ALLOWED_ORIGINS = new Set(["https://claude.ai", "https://chatgpt.com", "https://gemini.google.com"]);
const url = (p) => chrome.runtime.getURL(p);

pdfjs.GlobalWorkerOptions.workerSrc = url("pdf.worker.min.mjs");
const docOptions = {
  standardFontDataUrl: url("standard_fonts/"),
  cMapUrl: url("cmaps/"),
  cMapPacked: true,
  wasmUrl: url("wasm/"),
};

async function redactSpans(texts) {
  const res = await chrome.runtime.sendMessage({ type: "redact-spans", texts });
  if (!res || res.error) throw new Error(res?.error ?? "no response from service worker");
  return res.spans;
}

const handlers = {
  text: redactText,
  docx: redactDocx,
  pdf: (bytes, spans) => redactPdf(bytes, spans, { pdfjs, render: renderPage, docOptions }),
};

window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (event.source !== window.parent || !ALLOWED_ORIGINS.has(event.origin)) return;
  if (!msg || msg.source !== SOURCE || msg.type !== "redact") return;
  const reply = (data, transfer = []) =>
    window.parent.postMessage({ source: SOURCE, type: "result", id: msg.id, ...data }, event.origin, transfer);
  try {
    const out = await redactFile({ name: msg.name, type: msg.mime, bytes: new Uint8Array(msg.buffer) }, redactSpans, handlers);
    const buffer = out.bytes.buffer.slice(out.bytes.byteOffset, out.bytes.byteOffset + out.bytes.byteLength);
    reply({ status: out.status, count: out.count, buffer }, [buffer]);
  } catch (err) {
    reply({ error: String(err?.message ?? err) });
  }
});

const parentOrigin = location.ancestorOrigins?.[0];
if (ALLOWED_ORIGINS.has(parentOrigin)) {
  window.parent.postMessage({ source: SOURCE, type: "ready" }, parentOrigin);
}
