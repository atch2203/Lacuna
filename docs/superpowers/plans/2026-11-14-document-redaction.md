# Document Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redact attached PDF, DOCX, and text-like files before the chat site sees them, keeping PDFs visually identical except at replaced spans.

**Architecture:** An ISOLATED-world interceptor catches file `change`/`drop`/`paste` events in capture phase, sends file bytes (transferred) to a hidden extension-origin iframe, which routes by format (text / DOCX via JSZip / PDF via pdf.js + pdf-lib, rasterized with an invisible redacted text layer), gets stand-ins from the service worker's vault via a new `"redact-spans"` message, and returns redacted bytes; the interceptor re-dispatches the event with the redacted `File`. Fail open with a warning badge.

**Tech Stack:** Plain JS, esbuild, `node:test`, `pdfjs-dist`, `pdf-lib`, `jszip`, `@xmldom/xmldom`, Chrome MV3.

**Spec:** `docs/superpowers/specs/2026-11-14-document-redaction-design.md`

## Global Constraints

- Fail open: any processing error → attach the original file + warning badge naming the file and reason. Frame round-trip timeout 60 s per file.
- Limits: > 100 pages or > 50 MB → error (fail open).
- PDF: raster scale 2, long side capped at 4096 px, JPEG quality 0.92, output page size = original page size in points, hidden text layer Helvetica render mode 3, unencodable chars → `?` in hidden layer only; no metadata/annotations/links/forms/outlines carried over.
- DOCX parts processed: `word/document.xml`, `word/header*.xml`, `word/footer*.xml`, `word/footnotes.xml`, `word/endnotes.xml`, `word/comments.xml`, `docProps/core.xml`; all other parts byte-identical.
- Text-like extensions: `txt md csv tsv json xml yaml yml log` + source code `js ts jsx tsx py java c cc cpp h hpp cs go rs rb php sh sql html css`.
- Redacted `File` keeps `name`, `type`, `lastModified`.
- `settings.enabled === false` → interceptor does nothing.
- Vault access only through the service worker (single writer); file bytes never go through `chrome.runtime` messaging.

## Review Focus

1. **Same value in a prompt and a document** → identical stand-in (shared vault). Test in Task 1.
2. **Email split across three DOCX runs with different formatting** → original fully gone, stand-in in the first run. Test in Task 3.
3. **Sensitive value split across two PDF text items** (`"jane@"`, `"corp.io"`) → boxes on both items, hidden text of neither item contains a fragment of the original. Test in Task 4.
4. **Non-Latin PDF text** (`"café 你好"`) → hidden layer doesn't throw; unencodable chars become `?`. Test in Task 5.
5. **Mixed drop: PDF + PNG** → PDF redacted, PNG passed through unchanged, order preserved, notice lists the PNG. Test in Task 2.

---

## File Structure

```
src/engine/redact.js            + findRedactions
src/background/index.js         + "redact-spans" message
src/docs/router.js              classify + redactFile / redactFiles
src/docs/text.js                text-like files
src/docs/docx.js                DOCX (JSZip + xmldom)
src/docs/pdf-layout.js          pure PDF geometry/text helpers
src/docs/pdf.js                 redactPdf (pdf.js read, pdf-lib write, injected renderer)
src/docframe/index.js           frame entry: messages, OffscreenCanvas renderer, worker setup
static/docframe.html
src/content/docframe-client.js  inject frame, transfer bytes, 60 s timeout
src/content/file-interceptor.js change/drop/paste hold + re-dispatch
src/content/badge.js            + showInfoBadge
src/content/index.js            wire interceptor
static/manifest.json, build.mjs
tests/fixtures/{tiny.jpg, sample.docx (generated in test), …}
```

---

### Task 1: Span-level redaction + `"redact-spans"` message

**Files:** Modify `src/engine/redact.js`, `src/background/index.js`. Test `tests/find-redactions.test.js`.

**Interfaces:**
- Produces:
  - `findRedactions(text: string, detectors: Detector[], vault: Vault) → Array<{start: number, end: number, standIn: string}>` — non-overlapping, sorted by start, stand-ins assigned left-to-right.
  - `redact(text, detectors, vault)` unchanged signature, reimplemented via `findRedactions`.
  - SW message `{ type: "redact-spans", texts: string[] }` → `{ spans: Array<Array<{start,end,standIn}>> }` or `{ error }`; serialized with the existing `redactTexts` queue (same `serialize` wrapper, one vault load/save per call); `{ spans: texts.map(() => []) }` when disabled.

- [ ] **Step 1: Failing tests:**

```js
test("findRedactions returns spans with stand-ins", () => {
  const v = new Vault();
  assert.deepEqual(findRedactions("key AKIAIOSFODNN7EXAMPLE x", PATTERN_DETECTORS, v),
    [{ start: 4, end: 24, standIn: "[API_KEY_1]" }]);
});
test("findRedactions on clean text → []", () => {
  assert.deepEqual(findRedactions("hello", PATTERN_DETECTORS, new Vault()), []);
});
test("document and prompt share stand-ins via the vault", () => {
  const v = new Vault();
  const [span] = findRedactions("doc: AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v);
  assert.equal(redact("prompt AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v), `prompt ${span.standIn}`);
});
```

- [ ] **Step 2:** `npm test` → FAIL (`findRedactions` not exported).
- [ ] **Step 3:** Implement; add the SW message branch.
- [ ] **Step 4:** `npm test` → PASS (all prior tests still green).
- [ ] **Step 5:** Commit `feat: span-level redaction and redact-spans message`.

---

### Task 2: Router + text-like files

**Files:** Create `src/docs/router.js`, `src/docs/text.js`. Test `tests/docs-router.test.js`.

**Interfaces:**
- Consumes: none at runtime; `redactSpans` is injected.
- Produces:
  - `RedactSpans = (texts: string[]) => Promise<Array<Array<{start,end,standIn}>>>`
  - `classifyFile({ name: string, type: string }) → "pdf" | "docx" | "text" | null` — by MIME first (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/*`, `application/json`), else extension (Global Constraints list).
  - `redactText(bytes: Uint8Array, redactSpans) → Promise<{ bytes: Uint8Array, count: number }>`
  - `redactFile({ name, type, bytes }, redactSpans, handlers) → Promise<{ status: "redacted"|"unsupported"|"no-text", bytes: Uint8Array, count: number }>` — `handlers = { pdf, docx, text }`, each `(bytes, redactSpans) → Promise<{bytes, count}>`; `pdf` may return `{ status: "no-text" }`. Throws on > 50 MB (`"file exceeds 50 MB"`). Unsupported → `{status:"unsupported", bytes (same), count:0}`.
  - `applySpans(text: string, spans) → string` (splice helper, exported for Tasks 3–4).

- [ ] **Step 1: Failing tests:** classify `report.PDF` (no type) → `"pdf"`; `notes.docx` → `"docx"`; `{type:"text/csv"}` → `"text"`; `main.rs` → `"text"`; `photo.png` → `null`. `redactText` on `"mail jane@corp.io"` with a fake `redactSpans` returning `[[{start:5,end:17,standIn:"x@example.com"}]]` → bytes decode to `"mail x@example.com"`, `count === 1`. `redactFile` on a PNG → `status "unsupported"`, same bytes object. `redactFile` with 50 MB + 1 byte → rejects `/50 MB/`. Mixed (Review Focus 5): `Promise.all([pdf, png].map(f => redactFile(...)))` with a stub `pdf` handler → `["redacted","unsupported"]` in order.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement (UTF-8 via `TextDecoder`/`TextEncoder`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: document router and text-file redaction`.

---

### Task 3: DOCX

**Files:** Create `src/docs/docx.js`. Test `tests/docx.test.js`. `npm i jszip @xmldom/xmldom`.

**Interfaces:**
- Consumes: `RedactSpans`, `applySpans` (Task 2).
- Produces:
  - `rewriteRuns(nodeTexts: string[], spans: Array<{start,end,standIn}>) → string[]` — pure: given the `<w:t>` texts of one paragraph (concatenated = paragraph string) and spans over that string, return new texts per node: stand-in goes into the first node a span touches; covered chars removed from other touched nodes.
  - `redactDocx(bytes: Uint8Array, redactSpans) → Promise<{ bytes: Uint8Array, count: number }>` — one `redactSpans` call for all paragraphs of all processed parts (document order, then headers/footers/notes/comments, then core.xml text nodes).

- [ ] **Step 1: Failing tests:**

```js
test("span inside one run", () => {
  assert.deepEqual(rewriteRuns(["mail jane@corp.io now"], [{ start: 5, end: 17, standIn: "S" }]), ["mail S now"]);
});
test("span across three runs (Review Focus 2)", () => {
  assert.deepEqual(rewriteRuns(["mail ja", "ne@co", "rp.io now"], [{ start: 5, end: 17, standIn: "S" }]),
    ["mail S", "", " now"]);
});
test("two spans in one paragraph", () => {
  assert.deepEqual(rewriteRuns(["a X b", " Y c"], [{ start: 2, end: 3, standIn: "1" }, { start: 6, end: 7, standIn: "2" }]),
    ["a 1 b", " 2 c"]);
});
test("redactDocx round-trip", async () => { /* build a DOCX in-test with JSZip: [Content_Types].xml, word/document.xml with an email split across 3 <w:r> runs, docProps/core.xml with <dc:creator>Jane Real</dc:creator>; dictionary-free fake redactSpans that finds "jane@corp.io" and "Jane Real" by indexOf; assert output document.xml text content contains the stand-in and not "jane@corp.io" or any of "ja","ne@co" adjacent fragments; core.xml creator replaced; an untouched part (word/styles.xml) byte-identical. */ });
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement with `@xmldom/xmldom` `DOMParser`/`XMLSerializer` (works in Node and browser). Namespace `w = http://schemas.openxmlformats.org/wordprocessingml/2006/main`; set `xml:space="preserve"` on edited `<w:t>`. For `core.xml`, treat each element's text as its own "paragraph".
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: docx redaction`.

---

### Task 4: PDF layout helpers (pure)

**Files:** Create `src/docs/pdf-layout.js`. Test `tests/pdf-layout.test.js`.

**Interfaces:**
- Produces (TextItem = pdf.js item `{ str, transform: [a,b,c,d,e,f], width, height }`):
  - `buildPageText(items: TextItem[]) → { text: string, ranges: Array<[start, end]> }` — join items; `"\n"` between items whose baseline `transform[5]` differs by > 0.5 × item height, else `" "` unless either side already has whitespace at the joint; `ranges[i]` = item i's range in `text`.
  - `spanPieces(ranges, span) → Array<{ item: number, from: number, to: number }>` — char offsets within each touched item.
  - `pieceBox(item: TextItem, from, to, viewportTransform: number[6]) → { x, y, w, h }` — canvas-space box: x-range proportional to `from/len`..`to/len` of `item.width`, baseline at `transform[5]`, height `item.height` (fallback `hypot(transform[2], transform[3])`), mapped through `viewportTransform`.
  - `itemTexts(items, ranges, spans) → string[]` — redacted text per item for the hidden layer: stand-in placed in the first touched item, covered chars removed from others (reuse `rewriteRuns` from Task 3).

- [ ] **Step 1: Failing tests:** two items same baseline `"mail"` + `"jane@corp.io"` → text `"mail jane@corp.io"`, ranges `[[0,4],[5,17]]`; items on different baselines → joined by `"\n"`. Review Focus 3: items `"jane@"`, `"corp.io"` same baseline with no space in between (second item's x immediately after first's width → join with `""`): span `{start:0,end:12}` → `spanPieces` returns both items, `itemTexts` → `["S", ""]`. `pieceBox` with identity viewport, item `{str:"abcd", transform:[10,0,0,10,100,200], width:40, height:10}`, from 1 to 3 → `{x:110, y:190, w:20, h:10}`; with viewport `[2,0,0,-2,0,1584]` (pdf.js style y-flip at scale 2) → `{x:220, y:1584-2*210, w:40, h:20}`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. Joining rule for "no gap": if `|baselineΔ| ≤ 0.5h` and `item.x ≤ prev.x + prev.width + 0.15 × height`, join with `""`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: pdf layout helpers`.

---

### Task 5: PDF rebuild

**Files:** Create `src/docs/pdf.js`, `tests/fixtures/tiny.jpg` (valid 1×1 JPEG). Test `tests/pdf.test.js`. `npm i pdfjs-dist pdf-lib`.

**Interfaces:**
- Consumes: `buildPageText`, `spanPieces`, `pieceBox`, `itemTexts` (Task 4); `RedactSpans` (Task 2).
- Produces:
  - `Renderer = (page /* pdf.js PDFPageProxy */, viewport /* pdf.js PageViewport at render scale */, paints: Array<{ x, y, w, h, standIn, fontPx }>) → Promise<Uint8Array /* JPEG */>`
  - `redactPdf(bytes: Uint8Array, redactSpans, { pdfjs, render: Renderer }) → Promise<{ status?: "no-text", bytes: Uint8Array, count: number }>` — throws `"pdf has more than 100 pages"`; all pages' texts in one `redactSpans` call; scale = `min(2, 4096 / max(w, h))` per page; output built with pdf-lib: page size = `page.view` width/height in points, JPEG drawn full-page, hidden text via `pushOperators` with text render mode 3, Helvetica, per item at `transform[4], transform[5]`, size `hypot(transform[2], transform[3])`; unencodable chars → `?` (check with `font.encodeText` in try/catch per char or WinAnsi table). Returns `{status:"no-text"}` with original bytes when every page has zero items. `count` = total spans.

- [ ] **Step 1: Failing tests** (Node, `pdfjs-dist/legacy/build/pdf.mjs`; stub `render` returns `tiny.jpg` and records `paints`): build input PDF with pdf-lib: page 612×792, Helvetica text `"Contact jane@corp.io"` at (72,700) and `"key AKIAIOSFODNN7EXAMPLE"` at (72,680). Fake `redactSpans` = real `findRedactions` with `PATTERN_DETECTORS` + fresh `Vault`. Assert:
  - output extracted text (pdf.js `getTextContent` on output) contains the email fake and `[API_KEY_1]`, and contains neither `jane@corp.io` nor `AKIAIOSFODNN7EXAMPLE`;
  - output page size is 612×792;
  - `paints` has 2 entries with the right stand-ins;
  - output has no `/Annots` and no Info title/author;
  - Review Focus 4: input with `"café 你好 jane@corp.io"` (embed a font is unnecessary — construct items by stubbing: call internal `hiddenText(str)` helper exported for test) → `"caf? ?? …"`-style output, no throw;
  - image-only PDF (page with only an image) → `status "no-text"`;
  - 101-page PDF → rejects `/100 pages/`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: pdf rasterize + hidden text layer redaction`.

---

### Task 6: Doc frame + client

**Files:** Create `static/docframe.html`, `src/docframe/index.js`, `src/content/docframe-client.js`. Modify `build.mjs` (entry `docframe` + copy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` → `dist/pdf.worker.min.mjs`), `static/manifest.json` (`web_accessible_resources: [{ resources: ["docframe.html","docframe.js","pdf.worker.min.mjs"], matches: [the three hosts] }]`).

**Interfaces:**
- Consumes: `redactFile`, handlers from Tasks 2/3/5; SW `"redact-spans"` (Task 1).
- Produces:
  - Frame protocol (window.postMessage between content script and frame; `source: "llm-redactor-docframe"`): request `{ id, name, type, buffer: ArrayBuffer }` (buffer transferred) → response `{ id, status, buffer, count }` (transferred) or `{ id, error }`.
  - `redactInFrame(file: File) → Promise<{ status, file: File, count }>` — injects the hidden iframe once (`display:none`, `data-llm-redactor="docframe"`), waits for a `ready` message, rejects after 60 s with `"timed out"`; builds the output `File` with original `name`/`type`/`lastModified`.
  - Frame `Renderer`: `OffscreenCanvas` at viewport size, `page.render`, then for each paint: sample border pixels (1 px ring just outside the box) → median color fill; draw stand-in with `${fontPx}px sans-serif`, horizontally scaled to fit `w`; `convertToBlob({ type: "image/jpeg", quality: 0.92 })`.
  - Frame sets `pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs")`.

- [ ] **Step 1:** Implement frame + client.
- [ ] **Step 2:** `npm run build` → Expected: `dist/` contains `docframe.html`, `docframe.js`, `pdf.worker.min.mjs`; no esbuild errors.
- [ ] **Step 3:** `npm test` → PASS (no regressions).
- [ ] **Step 4: Manual check** (Claude in Chrome, after user reloads the extension): on claude.ai, in the content-script context run `redactInFrame` on a `File` built from a generated PDF → Expected: resolves with `status "redacted"` within a few seconds; no CSP error in console. If CSP blocks the frame, ledger a ruling and switch to the offscreen-document fallback (spec §2).
- [ ] **Step 5:** Commit `feat: document processing frame`.

---

### Task 7: File interceptor + badges + live check

**Files:** Create `src/content/file-interceptor.js`. Modify `src/content/badge.js`, `src/content/index.js`.

**Interfaces:**
- Consumes: `redactInFrame` (Task 6), `showWarningBadge` (existing), settings via `loadState`/`onStateChange`.
- Produces:
  - `showInfoBadge(message: string, { timeoutMs = 4000 } = {}) → void` — neutral-color pill, auto-dismiss.
  - `startFileInterceptor({ processFile: (File) => Promise<{status, file, count}>, isEnabled: () => boolean, notify: { info, warn } }) → { stop() }` — capture-phase `change` (input[type=file]), `drop`, `paste` (only when files present) listeners on `window`; skip self-dispatched events (WeakSet); per file: `try processFile` / on throw → original file + `warn("Could not redact <name> — attached unredacted: <reason>")`; `unsupported` → `warn("<name> attached unredacted (unsupported type)")`; `no-text` → `warn("<name> has no text layer — attached unredacted")`; success → `info("Redacted N items in <name>")`; "Redacting <name>…" info while working. Re-dispatch: input → set `files` via `DataTransfer`, dispatch `input` and `change` (bubbles); drop → `new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true, clientX, clientY })` on original target; paste → `new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true })`.

- [ ] **Step 1:** Implement; wire in `content/index.js` with `isEnabled` from current settings.
- [ ] **Step 2:** `npm run build`, `npm test` → build clean, all tests PASS.
- [ ] **Step 3: Live check per site** (Claude in Chrome; user reloads extension; test files generated locally into the scratchpad — a 1-page PDF and a DOCX each containing `jane@corp.io` and `AKIAIOSFODNN7EXAMPLE`): attach via the site's file input (use the file-upload tool). Expected on each of claude.ai, chatgpt.com (logged out, if uploads are allowed there), gemini.google.com: info badge "Redacted 2 items…"; asking "quote the email and key in the attached file exactly, then spell the key with spaces" → spelled form shows stand-in characters. If a site doesn't use an `<input type=file>` change event, investigate (drop/paste/`showOpenFilePicker`) and ledger a ruling.
- [ ] **Step 4:** Commit `feat: intercept and redact attached files`.
