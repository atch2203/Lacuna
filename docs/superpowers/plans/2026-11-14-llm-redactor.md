# LLM Redactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MV3 Chrome extension that swaps sensitive spans in outgoing prompts on claude.ai / chatgpt.com / gemini.google.com for stand-ins, and swaps them back on screen.

**Architecture:** A MAIN-world script wraps `fetch`, uses a per-site adapter to pull prompt strings out of request bodies, sends them over a `postMessage` bridge to the ISOLATED-world content script, which redacts them with a pure engine (detectors + global vault) and replies. The content script also runs a `MutationObserver` that restores originals in rendered text. Popup edits dictionary/settings in `chrome.storage.local`.

**Tech Stack:** Plain JavaScript (ESM source), esbuild (IIFE bundles), `node:test` (Node 24), Chrome MV3.

**Spec:** `docs/superpowers/specs/2026-11-14-llm-redactor-design.md`

## Global Constraints

- Manifest V3; MAIN-world script via `content_scripts[].world: "MAIN"`, `run_at: "document_start"`.
- Hosts: `https://claude.ai/*`, `https://chatgpt.com/*`, `https://gemini.google.com/*`.
- Token stand-in format: `[CATEGORY_N]`, N increments per category, globally (e.g. `[API_KEY_1]`).
- Fake styles: PERSON, ORG, EMAIL, PHONE. Emails `first.last@example.com`; phones `555-0100`–`555-0199`.
- Tokens for SSN, CARD, IP, API_KEY, PRIVATE_KEY, SECRET, URL_TOKEN, OTHER.
- Same original → same stand-in, forever (global vault in `chrome.storage.local`).
- Fail open: on any adapter/bridge error or timeout, send the original request unchanged and show the warning badge. Never throw into the page's fetch caller.
- Never modify `contenteditable`, `textarea`, `input` content.
- Engine modules (`src/engine/*`) are pure: no `chrome.*`, no DOM — testable under Node.

## Review Focus

1. **Prompt with nothing sensitive** → request body must be byte-identical (no JSON re-serialization). Test in Task 5.
2. **`[CARD_1]` vs `[CARD_10]` both in vault** → restorer must replace `[CARD_10]` whole, not `[CARD_1]` + `0`. Test in Task 4.
3. **Dictionary term inside a longer word** ("Ann" in "Annual") → not redacted. Test in Task 3.
4. **Bridge never answers** (content script not loaded yet, or crashed) → fetch proceeds unmodified within the timeout, badge shown. Test in Task 5.
5. **`fetch(new Request(url, {body}))`** (Request object, no init) → still redacted. Test in Task 5.

---

## File Structure

```
package.json            scripts: build, watch, test
build.mjs               esbuild: 3 bundles + copy static/ → dist/
static/manifest.json
static/popup.html
src/engine/fakes.js       fake + token generators
src/engine/vault.js       Vault: original ⇄ stand-in
src/engine/patterns.js    Tier 1 detectors
src/engine/dictionary.js  Tier 2 detectors
src/engine/redact.js      overlap resolution + substitution
src/engine/restore.js     stand-in → original string replacer
src/shared/bridge.js      postMessage protocol (both worlds)
src/main/fetch-hook.js    fetch wrapper
src/main/adapters/{index,claude,chatgpt,gemini}.js
src/main/index.js         MAIN entry
src/content/store.js      chrome.storage wrapper
src/content/dom-restorer.js
src/content/badge.js
src/content/index.js      ISOLATED entry
src/popup/popup.js
tests/*.test.js, tests/fixtures/*
```

---

### Task 1: Scaffold, fakes, vault

**Files:**
- Create: `package.json`, `build.mjs`, `.gitignore`, `src/engine/fakes.js`, `src/engine/vault.js`
- Test: `tests/vault.test.js`

**Interfaces:**
- Produces:
  - `tokenFor(category: string, n: number) → string` → `"[API_KEY_1]"`
  - `fakeFor(category: "PERSON"|"ORG"|"EMAIL"|"PHONE", n: number) → string` — deterministic by n; walks name lists so n=1,2,… give distinct values.
  - `class Vault { constructor(state?: VaultState); standInFor(original: string, category: string, style: "token"|"fake", avoid?: string) → string; entries() → Array<[standIn, original]>; toJSON() → VaultState }`
  - `VaultState = { byOriginal: {[orig]: standIn}, byStandIn: {[standIn]: orig}, counters: {[category]: number} }`

- [ ] **Step 1: Scaffold.** `package.json` with `"type": "module"`, devDependency `esbuild`, scripts `build` (`node build.mjs`), `watch` (`node build.mjs --watch`), `test` (`node --test tests/`). `build.mjs` bundles `src/main/index.js → dist/main.js`, `src/content/index.js → dist/content.js`, `src/popup/popup.js → dist/popup.js` as `format: "iife"`, and copies `static/*` into `dist/`. `.gitignore`: `node_modules/`, `dist/`. Run `npm install`.

- [ ] **Step 2: Write failing tests** in `tests/vault.test.js`:

```js
test("same original → same stand-in", () => {
  const v = new Vault();
  assert.equal(v.standInFor("a@b.com", "EMAIL", "fake"), v.standInFor("a@b.com", "EMAIL", "fake"));
});
test("tokens count per category", () => {
  const v = new Vault();
  assert.equal(v.standInFor("k1", "API_KEY", "token"), "[API_KEY_1]");
  assert.equal(v.standInFor("k2", "API_KEY", "token"), "[API_KEY_2]");
  assert.equal(v.standInFor("4111111111111111", "CARD", "token"), "[CARD_1]");
});
test("fake email shape", () => {
  assert.match(new Vault().standInFor("x@corp.io", "EMAIL", "fake"), /^[a-z]+\.[a-z]+@example\.com$/);
});
test("fake phone in 555-0100..0199", () => {
  assert.match(new Vault().standInFor("413-555-8812", "PHONE", "fake"), /^555-01\d\d$/);
});
test("fake skips values present in avoid text and already-used stand-ins", () => {
  const first = fakeFor("PERSON", 1);
  const v = new Vault();
  assert.notEqual(v.standInFor("Alice Real", "PERSON", "fake", `hi ${first}`), first);
});
test("round-trips through JSON", () => {
  const v = new Vault(); const s = v.standInFor("k1", "API_KEY", "token");
  const v2 = new Vault(JSON.parse(JSON.stringify(v.toJSON())));
  assert.deepEqual(v2.entries(), [[s, "k1"]]);
  assert.equal(v2.standInFor("k2", "API_KEY", "token"), "[API_KEY_2]");
});
```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** `fakes.js` (bundled first/last/org name arrays, ~30 each) and `vault.js`. On fake collision (in `byStandIn` or `avoid.includes(candidate)`), bump the counter and retry.
- [ ] **Step 5: Run** `npm test` — Expected: PASS.
- [ ] **Step 6: Commit** `feat: scaffold, fake generators, vault`.

---

### Task 2: Tier 1 pattern detectors

**Files:**
- Create: `src/engine/patterns.js`
- Test: `tests/patterns.test.js`

**Interfaces:**
- Produces:
  - `Detector = { id: string, category: string, style: "token"|"fake", find(text: string) → Span[] }`, `Span = { start: number, end: number }`
  - `PATTERN_DETECTORS: Detector[]` — ids: `email, phone, ssn, card, ip, api_key, private_key, secret, url_token`
  - `luhnValid(digits: string) → boolean`

- [ ] **Step 1: Write failing tests.** Helper `hits(id, text)` returns `text.slice(start,end)` for each span of detector `id`. Cases:

| id | must match (exact slice) | must NOT match |
|---|---|---|
| email | `jane.doe+x@corp.co.uk` | `foo@bar` |
| phone | `(413) 555-8812`, `+1 413-555-8812` | `2024-11-14` |
| ssn | `123-45-6789` | `000-12-3456`, `666-12-3456`, `123-00-6789` |
| card | `4111 1111 1111 1111`, `4111-1111-1111-1111` | `4111 1111 1111 1112` (bad Luhn) |
| ip | `192.168.1.20`, `2001:db8::1` | `999.1.1.1`, `1.2.3` |
| api_key | `AKIAIOSFODNN7EXAMPLE`, `sk-ant-api03-abc…` (≥20 chars), `ghp_` + 36 chars, a 3-part `eyJ…` JWT | `sk-` alone, `ask-me` |
| private_key | whole `-----BEGIN RSA PRIVATE KEY-----…-----END RSA PRIVATE KEY-----` block | `BEGIN PUBLIC KEY` block |
| secret | in `password=hunter2` → `hunter2`; in `api_secret: "s3cr3t"` → `s3cr3t` | `password` with no value |
| url_token | in `https://x.com/a?token=abc123&q=1` → `abc123` | `https://x.com/a?q=1` |

Plus: `luhnValid("4111111111111111") === true`, `luhnValid("4111111111111112") === false`.

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.** One regex per detector with the `g` flag; `secret`/`url_token` report the capture group's offsets (use the `d` flag → `match.indices[1]`). Styles: email/phone `fake`; rest `token`. Categories = uppercase ids (`url_token` → `URL_TOKEN`).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: tier 1 pattern detectors`.

---

### Task 3: Dictionary detectors + redact engine

**Files:**
- Create: `src/engine/dictionary.js`, `src/engine/redact.js`
- Test: `tests/redact.test.js`

**Interfaces:**
- Consumes: `Detector`, `Span` (Task 2), `Vault` (Task 1).
- Produces:
  - `makeDictionaryDetectors(entries: Array<{term: string, category: "PERSON"|"ORG"|"OTHER"}>) → Detector[]` — PERSON/ORG `fake`, OTHER `token`; ids `dict:<term>`.
  - `resolveOverlaps(spans: Array<Span & {detector}>) → same[]` — longest wins, then earliest; result sorted by start, non-overlapping.
  - `redact(text: string, detectors: Detector[], vault: Vault) → string`

- [ ] **Step 1: Write failing tests:**

```js
test("dictionary is case-insensitive, whole word", () => {
  const [d] = makeDictionaryDetectors([{ term: "Ann", category: "PERSON" }]);
  assert.equal(d.find("ann said hi").length, 1);
  assert.equal(d.find("Annual report").length, 0);
});
test("dictionary escapes regex chars", () => {
  const [d] = makeDictionaryDetectors([{ term: "c++ team", category: "OTHER" }]);
  assert.equal(d.find("the C++ team").length, 1);
});
test("longest overlapping span wins", () => {
  const r = resolveOverlaps([{start:0,end:5},{start:2,end:12},{start:20,end:22}]);
  assert.deepEqual(r.map(s=>[s.start,s.end]), [[2,12],[20,22]]);
});
test("redact replaces all, consistent for repeats", () => {
  const v = new Vault();
  const out = redact("key AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLE", PATTERN_DETECTORS, v);
  assert.equal(out, "key [API_KEY_1] and [API_KEY_1]");
});
test("redact leaves clean text identical", () => {
  assert.equal(redact("hello world", PATTERN_DETECTORS, new Vault()), "hello world");
});
test("fake never equals text already in the prompt", () => {
  const v = new Vault(); const first = fakeFor("PERSON", 1);
  const dets = makeDictionaryDetectors([{ term: "Bob Real", category: "PERSON" }]);
  assert.ok(!redact(`Bob Real met ${first}`, dets, v).startsWith(first));
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.** `redact` collects spans from all detectors (tagging each with its detector), resolves overlaps, substitutes right-to-left, passing the full original `text` as `avoid`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: dictionary detectors and redact engine`.

---

### Task 4: String restorer + DOM restorer

**Files:**
- Create: `src/engine/restore.js`, `src/content/dom-restorer.js`
- Test: `tests/restore.test.js`

**Interfaces:**
- Consumes: `Vault.entries()` (Task 1).
- Produces:
  - `makeRestorer(entries: Array<[standIn, original]>) → (text: string) => string` — identity fn when entries empty.
  - `startDomRestorer({ getRestore: () => (text)=>string, root?: Node }) → { refresh(): void, stop(): void }`

- [ ] **Step 1: Write failing tests:**

```js
test("restores multiple stand-ins", () => {
  const r = makeRestorer([["[API_KEY_1]", "AKIA…"], ["Jordan Lee", "Ann Real"]]);
  assert.equal(r("Jordan Lee owns [API_KEY_1]."), "Ann Real owns AKIA….");
});
test("prefix stand-ins: longest first", () => {
  const r = makeRestorer([["[CARD_1]", "one"], ["[CARD_10]", "ten"]]);
  assert.equal(r("[CARD_10] [CARD_1]"), "ten one");
});
test("regex chars in stand-ins are literal", () => {
  assert.equal(makeRestorer([["[IP_1]", "10.0.0.1"]])("I1 [IP_1]"), "I1 10.0.0.1");
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement `makeRestorer`**: one alternation regex of escaped stand-ins sorted by length desc; lookup map for replacement.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Implement `startDomRestorer`** (no unit test; verified manually in Task 6). Walk text nodes with `TreeWalker` under `root` (default `document.body`); skip nodes whose ancestor is `[contenteditable]`, `textarea`, `input`, `script`, `style`, or `[data-llm-redactor]`; write `node.nodeValue` only when the restored value differs (this is the re-entrancy guard). Also restore `document.title`. `MutationObserver` on `childList, subtree, characterData`; coalesce work into one `requestAnimationFrame`, processing only added/changed nodes. `refresh()` rescans the whole root (used when vault changes).
- [ ] **Step 6: Commit** `feat: stand-in restorers`.

---

### Task 5: Bridge + fetch hook

**Files:**
- Create: `src/shared/bridge.js`, `src/main/fetch-hook.js`, `src/main/adapters/index.js`
- Test: `tests/fetch-hook.test.js`

**Interfaces:**
- Produces:
  - `Adapter = { id: string, matches(url: URL, method: string) → boolean, extract(body: string) → string[], inject(body: string, texts: string[]) → string }`
  - `ADAPTERS: Adapter[]` in `adapters/index.js` (empty array now; Tasks 7–9 append).
  - bridge (message shape `{ source: "llm-redactor", type, id, texts?, reason? }` over `window.postMessage`):
    - `requestRedaction(win, texts: string[], timeoutMs = 2000) → Promise<string[]>` — rejects on timeout.
    - `serveRedaction(win, handler: (texts: string[]) => string[] | Promise<string[]>) → void`
    - `reportFailure(win, reason: string) → void`, `onFailure(win, cb: (reason) => void) → void`
  - `installFetchHook({ win, adapters, redactTexts: (texts)=>Promise<string[]>, onError: (reason)=>void }) → void`

- [ ] **Step 1: Write failing tests.** Use a fake `win = { fetch: async (input, init) => calls.push({input, init}) }`; `Request` and `URL` are Node globals. Test adapter: matches `https://x.test/send` POST, body JSON `{prompt}`, `extract = b => [JSON.parse(b).prompt]`, `inject` sets prompt.

```js
test("redacts body passed via init", async () => { /* fetch(url,{method:"POST",body}) → calls[0] body has "[API_KEY_1]" */ });
test("redacts body of a Request object", async () => { /* fetch(new Request(url,{method:"POST",body})) → forwarded body redacted */ });
test("non-matching URL passes through untouched", async () => { /* calls[0].input === original input, init === original init */ });
test("unchanged texts → original body forwarded byte-identical", async () => { /* redactTexts identity, body with odd spacing '{ "prompt" :"hi" }' preserved exactly */ });
test("redactTexts rejects → original request sent, onError called", async () => {});
test("adapter.extract throws → original request sent, onError called", async () => {});
```

and in the same file, bridge tests with a minimal `EventTarget`-based fake window (`postMessage(data) → dispatch MessageEvent("message",{data, source: win})`):

```js
test("bridge round-trip", async () => { serveRedaction(w, t => t.map(s => s.toUpperCase())); assert.deepEqual(await requestRedaction(w, ["a"]), ["A"]); });
test("bridge times out with no server", async () => { await assert.rejects(requestRedaction(w, ["a"], 50)); });
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement bridge.** Filter messages by `event.source === win` and `data.source === "llm-redactor"`; correlate by random `id`.
- [ ] **Step 4: Implement fetch hook.** Wrap `win.fetch`. Resolve URL/method/body from `init` first, else from a `Request` input (`await input.clone().text()`). Only string bodies are handled; anything else passes through. If redacted texts all equal the extracted ones, forward the original arguments. Otherwise forward `(url, {...init, body: newBody})` for init calls, or `new Request(input, { body: newBody })` for Request inputs. Wrap the whole transform in try/catch → `onError(reason)` + forward the original args.
- [ ] **Step 5: Run** `npm test` — Expected: PASS.
- [ ] **Step 6: Commit** `feat: postMessage bridge and fetch hook`.

---

### Task 6: Wire up extension (store, content entry, main entry, badge, manifest)

**Files:**
- Create: `src/content/store.js`, `src/content/badge.js`, `src/content/index.js`, `src/main/index.js`, `static/manifest.json`, `static/popup.html` (placeholder body; Task 10 fills it)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `loadState() → Promise<{ vault: Vault, dictionary: DictEntry[], settings: { enabled: boolean } }>` (defaults: empty vault, `[]`, `{enabled: true}`)
  - `saveVault(vault: Vault) → Promise<void>`
  - `onStateChange(cb: (state) => void) → void` — wraps `chrome.storage.onChanged`.
  - `showWarningBadge(message: string) → void` — fixed bottom-right pill in a shadow root under a `[data-llm-redactor]` host; click dismisses; repeated calls update text.
  - Storage keys: `vault`, `dictionary`, `settings`.

- [ ] **Step 1: `src/main/index.js`**: `installFetchHook({ win: window, adapters: ADAPTERS, redactTexts: t => requestRedaction(window, t), onError: r => reportFailure(window, r) })`.
- [ ] **Step 2: `src/content/index.js`**: load state; `serveRedaction` handler → if `!settings.enabled` return texts unchanged; else build detectors (`PATTERN_DETECTORS` + `makeDictionaryDetectors(dictionary)`), `redact` each text, `saveVault` if the vault changed, return. Start the DOM restorer once `document.body` exists, with `getRestore` returning a cached `makeRestorer(vault.entries())` that is rebuilt (followed by `refresh()`) on vault change. `onFailure` → `showWarningBadge("Redaction failed — message sent unredacted: " + reason)`. `onStateChange` → replace in-memory state.
- [ ] **Step 3: `static/manifest.json`**: MV3, name "LLM Redactor", `permissions: ["storage"]`, `action.default_popup: "popup.html"`, two `content_scripts` entries on the three hosts, both `run_at: "document_start"`, `all_frames: false`: `{ js: ["main.js"], world: "MAIN" }` and `{ js: ["content.js"] }`.
- [ ] **Step 4: Build + load.** Run `npm run build` → Expected: `dist/` has `manifest.json, main.js, content.js, popup.js, popup.html`. Load `dist/` unpacked at `chrome://extensions`. Expected: no errors on the extension card; on claude.ai, DevTools console has no errors from `main.js`/`content.js`.
- [ ] **Step 5: Smoke-test the restorer.** In DevTools on any target site (content-script context), seed a vault entry via `chrome.storage.local.set`, then put the stand-in into a page text node → Expected: it becomes the original within a frame.
- [ ] **Step 6: Commit** `feat: wire content and main scripts, manifest, warning badge`.

---

### Tasks 7–9: Site adapters (one task per site)

Each follows the same shape. **Expected** endpoints below are from memory — verify in DevTools first, and capture *every* request that carries prompt text (send, edit, retry, title generation).

| Task | File | Expected endpoint(s) | Expected prompt location |
|---|---|---|---|
| 7 | `src/main/adapters/claude.js` | POST `/api/organizations/*/chat_conversations/*/completion`, `…/retry_completion`, `…/title` | JSON `prompt`; title: `message_content` |
| 8 | `src/main/adapters/chatgpt.js` | POST `/backend-api/conversation` (also check `/backend-api/f/conversation`) | JSON `messages[*].content.parts[*]` where part is a string |
| 9 | `src/main/adapters/gemini.js` | POST `…/assistant.lamda.BardFrontendService/StreamGenerate` | form-encoded `f.req` = JSON `[null, "<inner JSON string>"]`; prompt at `inner[0][0]` |

**Files (per task):** Create the adapter; Modify `src/main/adapters/index.js` to append it; Create `tests/fixtures/<site>-*.txt` (raw captured bodies, with any real personal data scrubbed); Test `tests/adapters.test.js` (append a `describe` per site).

**Interfaces:** each exports `default` an `Adapter` (Task 5) with `id` `"claude" | "chatgpt" | "gemini"`.

- [ ] **Step 1: Capture.** On the site, send a prompt and an edit/retry, then copy each prompt-bearing request URL + raw body into `tests/fixtures/`. If the shape differs from the table, update the table in this plan.
- [ ] **Step 2: Write failing tests** per fixture: `matches(new URL(fixtureUrl), "POST") === true`; `matches` false for an unrelated same-host URL (e.g. a GET conversation list); `extract(body)` deep-equals the known prompt string(s); `extract(inject(body, ["X"]))` deep-equals `["X"]`; for Gemini, `inject` output must still parse as a form body whose `f.req` is valid nested JSON.
- [ ] **Step 3: Run** `npm test` — Expected: FAIL.
- [ ] **Step 4: Implement.** JSON adapters parse/re-stringify (only reached when something changed, per Task 5). Gemini: `URLSearchParams` → `JSON.parse(f.req)` → `JSON.parse(outer[1])` → set → re-stringify both levels → `URLSearchParams.toString()`.
- [ ] **Step 5: Run** `npm test` — Expected: PASS.
- [ ] **Step 6: Live check.** `npm run build`, reload extension, send `email me at jane@corp.io, key AKIAIOSFODNN7EXAMPLE` → Expected: Network tab request body shows a fake email + `[API_KEY_1]`; on-screen sent message and reply show originals; after page reload, history still shows originals; no warning badge.
- [ ] **Step 7: Commit** `feat: <site> adapter`.

---

### Task 10: Popup

**Files:**
- Modify: `static/popup.html`
- Create: `src/popup/popup.js`

**Interfaces:**
- Consumes: storage keys `vault`, `dictionary`, `settings` (Task 6). Popup reads/writes `chrome.storage.local` directly; content scripts pick changes up via `onStateChange`.

- [ ] **Step 1: Build UI.** Sections: (a) "Enabled" checkbox → `settings.enabled`; (b) dictionary list with term input, category `<select>` (PERSON/ORG/OTHER), add and remove buttons, duplicates ignored case-insensitively; (c) vault table (stand-in ⇄ original, originals masked until "show" clicked) and "Clear vault" button with a `confirm()` warning that old chats will stop restoring.
- [ ] **Step 2: Manual check.** Build, reload. Add dictionary term "Project Falcon" (OTHER) → send "status of Project Falcon?" on claude.ai → Expected: request body has `[OTHER_1]`; page shows "Project Falcon". Toggle Enabled off → next send has raw text. Vault table lists both entries.
- [ ] **Step 3: Commit** `feat: popup for settings, dictionary, vault`.
