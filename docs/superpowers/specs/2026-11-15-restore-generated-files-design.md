# Restore Generated Files — Design (short)

Date: 2026-11-15
Status: Approved

## Intent
Files the model generates (PDF, DOCX, text-like) contain stand-ins, because
the model only saw stand-ins. On the AI sites, swap stand-ins back to the real
values in files the site hands the user (preview and download).

## Design
- **Where:** the MAIN-world fetch hook on claude.ai / chatgpt.com /
  gemini.google.com also inspects responses. A response is a "file" when:
  - content-type is PDF or DOCX, or
  - it has a `Content-Disposition` with a filename and a text-like type
    (text/*, csv, markdown, json).
  Streams (`text/event-stream`) and plain API JSON (no Content-Disposition)
  are never touched.
- **Flow:** MAIN reads the body, hands the bytes (transferred) to the
  ISOLATED script, which sends them to the document frame in **restore**
  mode, and gets back bytes; MAIN returns a new `Response` with the same
  status and headers (minus `content-length`). Any error → the original
  response, unchanged (fail open; nothing sensitive is at stake).
- **Restore mode** reuses the document pipeline: the format handlers take a
  `spansFor(texts)` function; in restore mode it returns spans for every
  stand-in occurrence with the **original** as the replacement (service
  worker message `restore-spans`, vault + session guard map). If nothing
  matches, the original bytes are returned untouched (no rasterizing).
- PDF in restore mode: same rasterize + hidden-text rebuild, painting the
  originals.
- Only on the AI hosts. The site's page script sees the restored file — the
  same exposure as the on-screen restore already accepted on those hosts.

## Not covered
Downloads the browser performs directly from a link (no page fetch); values
the model rephrased.

## Approaches
Per-site download adapters (rejected: fragile, like the prompt adapters);
content-type based response rewriting (chosen).
