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
import { renderPage, measureText } from "./render.js";

const SOURCE = "llm-redactor-docframe";
const ALLOWED_ORIGINS = new Set(["https://claude.ai", "https://chatgpt.com", "https://gemini.google.com"]);
const url = (p) => chrome.runtime.getURL(p);
const parentOrigin = location.ancestorOrigins?.[0];

function toParent(data) {
  if (ALLOWED_ORIGINS.has(parentOrigin)) window.parent.postMessage({ source: SOURCE, ...data }, parentOrigin);
}

pdfjs.GlobalWorkerOptions.workerSrc = url("pdf.worker.min.mjs");
const docOptions = {
  standardFontDataUrl: url("standard_fonts/"),
  cMapUrl: url("cmaps/"),
  cMapPacked: true,
  wasmUrl: url("wasm/"),
};

const trace = (step) => toParent({ type: "trace", step });

async function redactSpans(texts) {
  trace(`redact-spans request (${texts.length} texts)`);
  const res = await chrome.runtime.sendMessage({ type: "redact-spans", texts });
  trace(`redact-spans response ${res?.error ? "error" : "ok"}`);
  if (!res || res.error) throw new Error(res?.error ?? "no response from service worker");
  return res.spans;
}

// onProgress is per request so the page side can extend that request's timeout.
const handlersFor = (onProgress) => ({
  text: redactText,
  docx: redactDocx,
  pdf: (bytes, spans) =>
    redactPdf(bytes, spans, {
      pdfjs,
      docOptions,
      measure: measureText,
      onProgress,
      render: async (page, viewport, paints) => {
        trace(`render page ${page.pageNumber} (${paints.length} paints)`);
        const jpeg = await renderPage(page, viewport, paints, pdfjs.AnnotationMode.DISABLE);
        trace(`rendered page ${page.pageNumber}`);
        return jpeg;
      },
    }),
});

window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (msg?.source === SOURCE) trace(`got ${msg.type} sourceIsParent=${event.source === window.parent} origin=${event.origin}`);
  if (event.source !== window.parent || !ALLOWED_ORIGINS.has(event.origin)) return;
  if (!msg || msg.source !== SOURCE || msg.type !== "redact") return;
  const reply = (data, transfer = []) =>
    window.parent.postMessage({ source: SOURCE, type: "result", id: msg.id, ...data }, event.origin, transfer);
  const onProgress = (p) => window.parent.postMessage({ source: SOURCE, type: "progress", id: msg.id, ...p }, event.origin);
  try {
    trace(`redacting ${msg.name} (${msg.buffer?.byteLength} bytes)`);
    const out = await redactFile({ name: msg.name, type: msg.mime, bytes: new Uint8Array(msg.buffer) }, redactSpans, handlersFor(onProgress));
    const buffer = out.bytes.buffer.slice(out.bytes.byteOffset, out.bytes.byteOffset + out.bytes.byteLength);
    reply({ status: out.status, count: out.count, warnings: out.warnings, buffer }, [buffer]);
  } catch (err) {
    trace(`failed: ${err?.message ?? err}`);
    reply({ error: String(err?.message ?? err) });
  }
});

toParent({ type: "ready" });
