# LLM Redactor — Chrome Extension Design

Date: 2026-11-14
Status: Approved

## Intent

Hackathon project. A Chrome extension that keeps sensitive data out of web LLM
chat UIs (claude.ai, chatgpt.com, gemini.google.com, more later). Sensitive
spans in the user's prompt are swapped for stand-ins before the request leaves
the browser; stand-ins are swapped back to originals on the page, so the user
sees their real data everywhere while the model only ever sees stand-ins.

Success = a live demo where the user types real-looking secrets/PII, the
conversation reads naturally with originals shown, and the network tab /
server-side history shows only stand-ins.

## Goals

- Redact Tier 1 (pattern-detected) and Tier 2 (user dictionary) data from
  outgoing prompts on claude.ai, chatgpt.com, gemini.google.com.
- Restore originals on screen: model replies (incl. while streaming), the
  user's own sent messages, old chat history, sidebar titles.
- Transparent: the input box is never visibly modified.
- Extensible: adding a detector, a site, or a feature should not require
  touching unrelated code.

## Non-goals (for now)

- Tier 3 NER (names/orgs/places via an in-browser model) — stretch, later.
- File upload redaction (PDF, DOCX, etc.) — **next after MVP**. See
  "Future: uploads" below.
- Restoring inside copy-button output, share links, other devices, model memory.
- Firefox/Safari.

## Anti-goals

- Breaking the chat site (a failed send or a mangled UI is worse than no
  redaction). On any adapter/parse error, fail **open with a visible warning
  badge**, not silently and not by blocking the send. *(Decided by user.)*
- Visible flicker of stand-ins in the input box.

## Accepted limitations

- Copy buttons, share links, model memory, other devices show stand-ins.
- Originals live in the page DOM after restore and in extension storage, so
  the site's own client-side JS could read them. Threat model is the
  server/model, not the page.
- A stand-in may flash for one frame before the DOM observer restores it.
- If the model alters a stand-in (e.g. "Jordan's", "JORDAN LEE", splits it
  across markdown nodes), restore may miss it.

## What gets redacted

### Tier 1 — patterns

| Category    | Detection                                                        | Stand-in style |
|-------------|------------------------------------------------------------------|----------------|
| EMAIL       | email regex                                                       | realistic fake |
| PHONE       | US/intl phone regex                                               | realistic fake (555-01xx range) |
| SSN         | `\d{3}-\d{2}-\d{4}` with invalid-range exclusions                 | token |
| CARD        | 13–19 digit runs (spaces/dashes allowed) + Luhn check             | token |
| IP          | IPv4, IPv6                                                        | token |
| API_KEY     | `AKIA…`, `sk-…`, `sk-ant-…`, `ghp_…`/`github_pat_…`, JWT (`eyJ…​.…​.…`) | token |
| PRIVATE_KEY | PEM `-----BEGIN … PRIVATE KEY-----` blocks                        | token |
| SECRET      | `password=`, `secret:`, `token=`-style assignments (value only)   | token |
| URL_TOKEN   | URLs with token-ish query params (`token`, `key`, `sig`, …) — redact the param value | token |

### Tier 2 — user dictionary

User-entered terms in the popup (own name, company, codenames, internal
hosts). Case-insensitive whole-word match. Each term has a category the user
picks: PERSON / ORG / OTHER. PERSON and ORG get realistic fakes; OTHER gets a
token.

### Stand-in styles (hybrid)

- **Token**: `[CATEGORY_N]`, e.g. `[API_KEY_1]`, `[CARD_2]`. N increments per
  category, globally.
- **Realistic fake**: drawn from bundled lists (first names, last names, org
  names). Emails derived as `first.last@example.com`; phones in the reserved
  fictional `555-0100`–`555-0199` range. A fake must not already be in the
  vault and must not appear in the text being redacted.

Same original → same stand-in, always (global vault).

## Approaches considered

1. **Rewrite input box on send** — fragile against ProseMirror/Gemini editors,
   misses edits/regenerations, visibly flashes stand-ins. Rejected.
2. **Network both ways** — wrap fetch, substitute outgoing, restore incoming
   stream. Most transparent, but per-site response parsing (SSE deltas,
   Gemini `batchexecute`) plus chunk-boundary buffering is the biggest time
   sink. Rejected.
3. **Network out, DOM in** — **chosen.** Wrap fetch for outgoing only (one
   choke point for typed/pasted/edited/regenerated prompts, editor untouched);
   restore via a site-agnostic `MutationObserver` over rendered text.

## Architecture

Manifest V3. Three runtime pieces:

```
 page (MAIN world)                 content script (ISOLATED world)        storage
 ┌──────────────────────┐          ┌───────────────────────────────┐    ┌──────────────┐
 │ fetch/XHR wrapper    │ request  │ redaction engine              │    │ chrome.storage│
 │  site adapter finds  │ ───────► │  detectors → spans            │◄──►│  .local       │
 │  prompt text in body │ ◄─────── │  vault: original ⇄ stand-in   │    │  vault, dict, │
 │  rewrites body       │ redacted │                               │    │  settings     │
 └──────────────────────┘          │ DOM restorer                  │    └──────────────┘
                                   │  MutationObserver → swap      │
                                   │  stand-ins back to originals  │
                                   └───────────────────────────────┘
 popup: on/off toggle, dictionary editor, vault viewer/clear
```

- **MAIN-world script** (`world: "MAIN"`, `run_at: document_start`) wraps
  `window.fetch` (and `XMLHttpRequest.send` if a site uses it). For each
  request, asks the site adapter whether it is a prompt request; if so,
  extracts the prompt string(s), sends them to the isolated script, awaits
  redacted strings, rebuilds the body, and continues the original call.
- **Bridge**: `window.postMessage` / `CustomEvent` with a request id; the
  MAIN script awaits the reply with a timeout (fail-open on timeout).
- **ISOLATED-world content script** owns the redaction engine and vault
  (needs `chrome.storage`), and runs the DOM restorer.
- **Popup**: settings UI.

### Extension points (the "add more later" seams)

- **Detector registry** — each detector: `{ id, category, style, find(text) → [{start, end, value}] }`.
  Engine runs all enabled detectors, resolves overlaps (longest span wins,
  then earliest), substitutes right-to-left.
- **Site adapter registry** — each adapter:
  `{ id, hosts, isPromptRequest(url, init), extract(body) → string[], inject(body, string[]) → body }`.
  Exact payload shapes per site are discovered by the builder in DevTools.
  An adapter must cover *every* request that carries prompt text, not just
  the main completion call (e.g. title-generation, edit, retry endpoints).
  Gemini's form-encoded nested-JSON `f.req` is expected to be the hardest.
- **Stand-in generators** — keyed by style/category; Tier 3 later plugs in as
  another detector with PERSON/ORG/PLACE categories reusing the fake
  generators.

### Vault

`chrome.storage.local`:
- `vault`: `{ byOriginal: {orig → standIn}, byStandIn: {standIn → orig}, counters: {category → n} }`
- `dictionary`: `[{ term, category }]`
- `settings`: `{ enabled, enabledDetectors }`

Engine keeps an in-memory copy, writes through on change, and listens to
`chrome.storage.onChanged` so multiple tabs stay consistent.

### DOM restorer

- On start and on each mutation batch: walk text nodes under `document.body`
  (TreeWalker), replace any stand-in with its original using one combined
  regex (stand-ins escaped, longest first). Rebuild the regex when the vault
  changes.
- Also restore `document.title`.
- Skip `contenteditable`, `textarea`, `input`, and the extension's own nodes.
- Re-entrancy guard so our own writes don't retrigger endless work; batch via
  `requestAnimationFrame`.
- React may re-render a restored node back to the stand-in; the observer just
  re-applies.

## Future: uploads (post-MVP)

Planned next: redact uploaded files (PDF, DOCX, plain text, etc.). MVP must
not preclude it:
- The fetch/XHR wrapper is the choke point for uploads too (multipart bodies,
  presigned PUTs). Site adapter interface should leave room for an
  `isUploadRequest` / file-body transform alongside the prompt hooks.
- The redaction engine works on plain strings and is reused as-is; uploads
  add per-format extract/rebuild steps (e.g. pdf.js, a DOCX zip/XML pass).
- Rebuilding a faithful PDF is hard; acceptable fallback is uploading a
  redacted text/markdown rendition. Decide when that work starts.

## Testing

- Unit tests (`node:test`) for each detector (true positives + near-miss
  negatives, e.g. non-Luhn card numbers), overlap resolution, vault
  consistency, fake generation non-collision, adapter extract/inject against
  captured sample payloads.
- Manual demo script per site: type a prompt containing an email, phone,
  AWS key, card, and a dictionary term → verify network payload shows
  stand-ins, page shows originals, reload shows originals in history.

## Calls made (not discussed — correct if wrong)

- **Tooling**: plain JavaScript, esbuild to bundle (MV3 content scripts can't
  be ES modules), `node:test` for unit tests. No framework for the popup.
- **Dictionary entries carry a user-chosen category** (PERSON/ORG/OTHER) so
  names get realistic fakes.
- **Per-site toggle** omitted; one global on/off switch.
- **Fake email domain** `example.com`; **phone range** 555-0100–0199.

## Left to the builder

- Exact request URL/payload shape per site (inspect in DevTools).
- Exact regexes and their false-positive tuning.
- Name/org lists for fakes.
- Popup layout.
