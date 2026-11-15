# Document Redaction — Design

Date: 2026-11-14
Status: Approved
Builds on: `2026-11-14-llm-redactor-design.md` (prompt redaction, shipped)

## Intent

Extend the extension so files the user attaches to claude.ai, chatgpt.com, or
gemini.google.com are redacted with the same detectors, dictionary, and global
vault as typed prompts — before the site ever sees the file. PDFs must look
as close to the original as possible, with only the sensitive spans replaced.
Model replies that quote the document are restored on screen by the existing
DOM restorer (no change needed there).

Success = demo: attach a PDF/DOCX containing an email, phone, AWS key, and a
dictionary term → the attachment preview and the file the site uploads show
stand-ins in place, layout otherwise unchanged; asking the model to quote the
values back shows stand-ins reaching the model and originals on screen.

## Goals

- Redact attached **PDF**, **DOCX**, and **text-like** files (txt, md, csv,
  tsv, json, xml, yaml, log, and common source-code extensions).
- PDF output visually matches the original except at replaced spans; text
  extracted from it (by the site or the model's backend) contains only
  stand-ins.
- Site-agnostic: no per-site upload adapters.
- Reuse the vault: a value in a document gets the same stand-in it would get
  in a prompt.

## Non-goals

- Images (PNG/JPG screenshots), XLSX, PPTX, other binaries — passed through
  unredacted with a visible notice. (Future.)
- OCR of scanned PDFs (image-only pages have no text layer to redact).
- Preserving PDF links, annotations, form fields, bookmarks, metadata.
- Logged-in ChatGPT (skipped for the hackathon, per user).

## Anti-goals

- A redacted PDF that still contains the original text anywhere (hidden text,
  metadata, annotations). Overlay-only redaction is explicitly rejected.
- Breaking the site's attach flow for files that need no redaction.

## Approaches

**Where to catch the file** — chosen: **swap the file before the site sees
it** (intercept file `<input>` change, drop, and paste; hand the page a
redacted `File`). Rejected: rewriting upload network requests — every site
uploads differently (resumable uploads, presigned URLs, multipart, chunking),
i.e. three fragile adapters like the prompt ones that already broke once.

**How to rebuild PDFs** — chosen: **rasterize each page + invisible redacted
text layer.** Rejected: (A) in-place content-stream text edits — subset fonts
lack glyphs for stand-in characters, text is split across operators,
encodings vary; (B) draw-over boxes — original text remains extractable,
which leaks.

## Architecture

```
 page (MAIN + ISOLATED content scripts)          extension "doc frame"            service worker
 ┌────────────────────────────────────┐          (hidden iframe, chrome-          ┌─────────────┐
 │ file interceptor (ISOLATED world)  │ transfer │  extension:// origin)            │ vault owner │
 │  change / drop / paste, capture    │ ArrayBuf │ ┌──────────────────────────┐    │ (existing)  │
 │  phase, before page listeners      │ ───────► │ │ format router            │    │             │
 │  → hold event, redact, re-dispatch │ ◄─────── │ │  pdf  (pdf.js + pdf-lib) │◄──►│ "redact-    │
 │    with redacted File              │ redacted │ │  docx (JSZip)            │    │  spans" msg │
 │ badge: "Redacting file…" / errors  │  bytes   │ │  text (string)           │    │             │
 └────────────────────────────────────┘          │ └──────────────────────────┘    └─────────────┘
```

### 1. File interceptor (content script, ISOLATED world)

Registered at `document_start` on `window`, capture phase, so it runs before
any page listener.

- **`change` on `input[type=file]`**: if any selected file is a supported
  type, `stopImmediatePropagation()`, process, then set `input.files` to a
  `DataTransfer` of the redacted files and dispatch new `input` + `change`
  events (bubbling).
- **`drop`** with `dataTransfer.files`: `preventDefault()` +
  `stopImmediatePropagation()`, process, then dispatch a synthetic
  `DragEvent("drop", { dataTransfer, bubbles, cancelable })` on the original
  target. Also re-dispatch is needed only for drop; `dragover` untouched.
- **`paste`** with files in `clipboardData`: same pattern with
  `ClipboardEvent("paste", { clipboardData })`. Text-only pastes untouched
  (prompt redaction already covers them on send).
- Events the interceptor dispatches itself are tagged (WeakSet) and skipped.
- When the extension is toggled off (`settings.enabled === false`), the
  interceptor does nothing.
- A PDF with no text layer (scanned) is passed through unchanged with a
  "no text found — not redacted" notice.
- Mixed selections: supported files are redacted; unsupported ones are passed
  through as-is and the badge lists them as "not redacted".
- Redacted `File` keeps the original `name`, `type`, and `lastModified`.
- If a site turns out to use `window.showOpenFilePicker` instead of an
  `<input>`, add a MAIN-world wrapper around the returned handles' `getFile()`
  that routes through the same pipeline via the existing postMessage bridge.
  *(Builder verifies per site; build only if needed.)*

### 2. Doc frame (hidden extension iframe)

The content script lazily injects one hidden
`<iframe src="chrome-extension://…/docframe.html">` (listed in
`web_accessible_resources`) and talks to it with `postMessage`, transferring
the file's `ArrayBuffer` (no copy, no base64). Why a frame: it runs at the
extension origin, so pdf.js can use a real Web Worker (no main-thread freeze
on the chat page) and it can call `chrome.runtime.sendMessage` for vault
access. `chrome.runtime` messaging is JSON-only, so file bytes must not go
through the service worker. *(Fallback if a site's CSP blocks the frame:
offscreen document + base64 over runtime messaging — builder's call.)*

The frame routes by MIME type, falling back to the file extension.

### 3. Engine change: span-level redaction

Add `findRedactions(text, detectors, vault) → Array<{ start, end, standIn }>`
to `src/engine/redact.js` (non-overlapping, sorted; assigns stand-ins via the
vault exactly like `redact`). `redact` is reimplemented on top of it. The
service worker gains a serialized `"redact-spans"` message:
`{ texts: string[] } → { spans: Array<Array<{start,end,standIn}>> }`, saving the
vault once per call. Documents are batched: one message per document (all
pages / paragraphs), so vault numbering follows reading order.

### 4. Text-like files

Decode UTF-8, `findRedactions` on the whole text, splice, re-encode. Output
type unchanged.

### 5. DOCX

JSZip the package; process `word/document.xml`, `word/header*.xml`,
`word/footer*.xml`, `word/footnotes.xml`, `word/endnotes.xml`,
`word/comments.xml`, and `docProps/core.xml` (author/title).

- Per `<w:p>`, concatenate the text of its `<w:t>` nodes (in order) into one
  paragraph string; remember each node's `[start, end)` in that string.
- `findRedactions` on the paragraph string.
- For each span: put the stand-in in the first `<w:t>` it touches (keeping
  that run's formatting), and delete the covered characters from the other
  touched `<w:t>` nodes. Set `xml:space="preserve"` on edited nodes.
- Parse/serialize with `DOMParser` / `XMLSerializer`; other parts are copied
  byte-for-byte.

### 6. PDF (rasterize + invisible text layer)

pdf.js (`pdfjs-dist`) to read, pdf-lib to write.

Per page:
1. `getTextContent()` → items (`str`, `transform`, `width`, `height`). Build
   the page string by joining items (newline between items whose baselines
   differ, space otherwise); record each item's range.
2. After the whole document's page strings come back from `"redact-spans"`:
3. Render the page to a canvas at **scale 2** (cap: 4096 px on the long side).
4. For each span, compute its box per touched item: x-range proportional to
   character offsets within the item's `width`, y from `transform` and
   `height`, mapped through the render viewport. Fill the box with the
   background color sampled just outside the box (median of the border
   pixels), then draw the stand-in in a sans-serif font whose size matches the
   item height, horizontally condensed (`ctx.scale`) if needed to fit the
   original box width.
5. Encode the canvas as JPEG (quality 0.92).
6. New pdf-lib page with the **original page size in points**; draw the image
   to fill it.
7. Invisible text layer: for each item, draw its redacted text (stand-ins
   spliced in) with standard Helvetica at the item's position and size, text
   render mode 3 (invisible), so extraction and copy/paste yield the
   redacted text. Characters Helvetica/WinAnsi can't encode are replaced with
   `?` in the hidden layer only (visible page is unaffected).

The output PDF is built fresh: no original metadata, annotations, links,
forms, outlines, or embedded files are carried over.

Limits: pages > 100 or file > 50 MB → not processed; treated as an error
(see Failure handling).

### 7. Feedback

Badge shows "Redacting <name>…" while working, then
"Redacted N items in <name>" (auto-dismiss after 4 s), or an error.

## Failure handling

*(Decided by user.)* Fail open: on any processing error (corrupt file, limit
exceeded, frame unavailable or timed out, redaction message failed), attach
the **original** file and show the warning badge naming the file and reason.
Frame round-trip timeout: 60 s per file.

## Testing

- Unit (`node:test`): `findRedactions`; DOCX run-splitting (span inside one
  run, across runs, across formatting boundaries, multiple spans per
  paragraph); text-file splice; PDF span→box geometry (pure function over
  synthetic text items + viewport); PDF page-string assembly.
- Fixture round-trips (Node, using JSZip / pdf-lib directly): a small DOCX
  with a split-run email → output DOCX's text has the stand-in and not the
  original; a small generated PDF → output PDF's extracted text (pdf.js in
  Node) contains stand-ins and not originals.
- Manual per site (Claude in Chrome): attach via picker, drag-drop, and paste;
  confirm preview shows stand-ins; ask the model to quote the values.

## Future (after documents)

- **Screen-share auto-hide** (user-requested next feature): while the user is
  screen sharing, hide sensitive values (IPs, keys, emails, …) anywhere in the
  page DOM. Detection of "sharing" and scope (which sites/tabs) to be designed
  then.
- Images (OCR + blur), XLSX/PPTX.

## Calls made (not discussed — correct if wrong)

- Hidden extension iframe for document processing (real worker, transferable
  buffers) instead of processing on the chat page's main thread.
- PDF raster scale 2, JPEG 0.92, Helvetica hidden layer with `?` fallback.
- Output metadata/annotations/links dropped (they could hold originals).
- Supported text-like extensions list as in Goals; unsupported types pass
  through with a "not redacted" notice.
- Limits: 100 pages / 50 MB.
