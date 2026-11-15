import { test } from "node:test";
import assert from "node:assert/strict";
import { installFetchHook } from "../src/main/fetch-hook.js";
import { requestRedaction, serveRedaction, reportFailure, onFailure } from "../src/shared/bridge.js";

const URL_SEND = "https://x.test/send";

const testAdapter = {
  id: "test",
  matches: (url, method) => url.pathname === "/send" && method === "POST",
  extract: (body) => [JSON.parse(body).prompt],
  inject: (body, [prompt]) => JSON.stringify({ ...JSON.parse(body), prompt }),
};

const upper = async (texts) => texts.map((t) => t.replace("SECRET", "[API_KEY_1]"));

function setup({ redactTexts = upper, adapters = [testAdapter] } = {}) {
  const calls = [];
  const errors = [];
  const win = { fetch: async (input, init) => (calls.push({ input, init }), "ok") };
  installFetchHook({ win, adapters, redactTexts, onError: (r) => errors.push(r) });
  return { win, calls, errors };
}

async function forwardedBody({ input, init }) {
  if (init?.body !== undefined) return init.body;
  return input instanceof Request ? input.text() : undefined;
}

test("redacts body passed via init", async () => {
  const { win, calls } = setup();
  const res = await win.fetch(URL_SEND, { method: "POST", body: JSON.stringify({ prompt: "my SECRET" }) });
  assert.equal(res, "ok");
  assert.equal(JSON.parse(await forwardedBody(calls[0])).prompt, "my [API_KEY_1]");
});

test("redacts body of a Request object", async () => {
  const { win, calls } = setup();
  await win.fetch(new Request(URL_SEND, { method: "POST", body: JSON.stringify({ prompt: "my SECRET" }) }));
  assert.equal(JSON.parse(await forwardedBody(calls[0])).prompt, "my [API_KEY_1]");
});

test("non-matching URL passes through untouched", async () => {
  const { win, calls } = setup();
  const init = { method: "POST", body: '{"prompt":"SECRET"}' };
  await win.fetch("https://x.test/other", init);
  assert.equal(calls[0].input, "https://x.test/other");
  assert.equal(calls[0].init, init);
});

test("GET to matching path passes through", async () => {
  const { win, calls } = setup();
  await win.fetch(URL_SEND);
  assert.equal(calls[0].input, URL_SEND);
});

test("unchanged texts → original body forwarded byte-identical", async () => {
  const { win, calls } = setup({ redactTexts: async (t) => t });
  const body = '{ "prompt" :"hi" }';
  const init = { method: "POST", body };
  await win.fetch(URL_SEND, init);
  assert.equal(calls[0].init, init);
  assert.equal(calls[0].init.body, body);
});

test("redactTexts rejects → original request sent, onError called", async () => {
  const { win, calls, errors } = setup({ redactTexts: async () => { throw new Error("timeout"); } });
  const init = { method: "POST", body: '{"prompt":"SECRET"}' };
  await win.fetch(URL_SEND, init);
  assert.equal(calls[0].init, init);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /timeout/);
});

test("adapter.extract throws → original request sent, onError called", async () => {
  const { win, calls, errors } = setup();
  const init = { method: "POST", body: "not json" };
  await win.fetch(URL_SEND, init);
  assert.equal(calls[0].init, init);
  assert.equal(errors.length, 1);
});

test("matched adapter + unreadable body → passes through with onError (visible fail-open)", async () => {
  const { win, calls, errors } = setup();
  const init = { method: "POST", body: new Uint8Array([1, 2]) };
  await win.fetch(URL_SEND, init);
  assert.equal(calls[0].init, init);
  assert.equal(errors.length, 1);
});

test("unmatched request with non-string body → no error", async () => {
  const { win, errors } = setup();
  await win.fetch("https://x.test/upload", { method: "POST", body: new Uint8Array([1]) });
  assert.equal(errors.length, 0);
});

test("URLSearchParams body is read as a string and redacted", async () => {
  const formAdapter = {
    id: "form",
    matches: (url) => url.pathname === "/form",
    extract: (b) => [new URLSearchParams(b).get("q")],
    inject: (b, [q]) => { const p = new URLSearchParams(b); p.set("q", q); return p.toString(); },
  };
  const { win, calls } = setup({ adapters: [formAdapter] });
  await win.fetch("https://x.test/form", { method: "POST", body: new URLSearchParams({ q: "my SECRET" }) });
  assert.equal(new URLSearchParams(calls[0].init.body).get("q"), "my [API_KEY_1]");
});

const bytesAdapter = {
  id: "bytes",
  bodyType: "bytes",
  matches: (url) => url.pathname === "/bin",
  extract: (b) => [new TextDecoder().decode(b)],
  inject: (_b, [t]) => new TextEncoder().encode(t),
};

test("bytes adapter: Uint8Array body is redacted and sent as bytes", async () => {
  const { win, calls } = setup({ adapters: [bytesAdapter] });
  await win.fetch("https://x.test/bin", { method: "POST", body: new TextEncoder().encode("my SECRET") });
  assert.ok(calls[0].init.body instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(calls[0].init.body), "my [API_KEY_1]");
});

test("bytes adapter: ArrayBuffer body is read", async () => {
  const { win, calls } = setup({ adapters: [bytesAdapter] });
  await win.fetch("https://x.test/bin", { method: "POST", body: new TextEncoder().encode("my SECRET").buffer });
  assert.equal(new TextDecoder().decode(calls[0].init.body), "my [API_KEY_1]");
});

test("bytes adapter: Request body is read as bytes", async () => {
  const { win, calls } = setup({ adapters: [bytesAdapter] });
  await win.fetch(new Request("https://x.test/bin", { method: "POST", body: new TextEncoder().encode("my SECRET") }));
  assert.equal(await calls[0].input.text(), "my [API_KEY_1]");
});

test("bytes adapter: string body is unreadable → onError", async () => {
  const { win, errors } = setup({ adapters: [bytesAdapter] });
  await win.fetch("https://x.test/bin", { method: "POST", body: "my SECRET" });
  assert.equal(errors.length, 1);
});

// I5 — XHR
import { installXhrHook } from "../src/main/xhr-hook.js";

function fakeXhrWindow() {
  const sent = [];
  class FakeXHR {
    open(method, url, async = true) { this._args = { method, url, async }; }
    send(body) { sent.push({ ...this._args, body }); }
  }
  return { win: { XMLHttpRequest: FakeXHR, location: { href: "https://x.test/" } }, sent };
}

test("xhr: matching send is redacted before the real send", async () => {
  const { win, sent } = fakeXhrWindow();
  const errors = [];
  installXhrHook({ win, adapters: [testAdapter], redactTexts: upper, onError: (e) => errors.push(e) });
  const xhr = new win.XMLHttpRequest();
  xhr.open("POST", "/send");
  xhr.send(JSON.stringify({ prompt: "my SECRET" }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(JSON.parse(sent[0].body).prompt, "my [API_KEY_1]");
  assert.equal(errors.length, 0);
});

test("xhr: non-matching send goes through synchronously untouched", () => {
  const { win, sent } = fakeXhrWindow();
  installXhrHook({ win, adapters: [testAdapter], redactTexts: upper, onError: () => {} });
  const xhr = new win.XMLHttpRequest();
  xhr.open("POST", "/other");
  xhr.send("SECRET");
  assert.equal(sent[0].body, "SECRET");
});

test("xhr: redaction failure sends original and reports", async () => {
  const { win, sent } = fakeXhrWindow();
  const errors = [];
  installXhrHook({ win, adapters: [testAdapter], redactTexts: async () => { throw new Error("timeout"); }, onError: (e) => errors.push(e) });
  const xhr = new win.XMLHttpRequest();
  xhr.open("POST", "/send");
  xhr.send('{"prompt":"SECRET"}');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent[0].body, '{"prompt":"SECRET"}');
  assert.equal(errors.length, 1);
});

test("xhr: synchronous matching request is sent untouched with a warning", () => {
  const { win, sent } = fakeXhrWindow();
  const errors = [];
  installXhrHook({ win, adapters: [testAdapter], redactTexts: upper, onError: (e) => errors.push(e) });
  const xhr = new win.XMLHttpRequest();
  xhr.open("POST", "/send", false);
  xhr.send('{"prompt":"SECRET"}');
  assert.equal(sent[0].body, '{"prompt":"SECRET"}');
  assert.equal(errors.length, 1);
});


// --- bridge ---

function fakeWindow() {
  const w = new EventTarget();
  w.postMessage = (data) => queueMicrotask(() => {
    const ev = new Event("message");
    ev.data = data;
    ev.source = w;
    w.dispatchEvent(ev);
  });
  return w;
}

test("bridge round-trip", async () => {
  const w = fakeWindow();
  serveRedaction(w, (t) => t.map((s) => s.toUpperCase()));
  assert.deepEqual(await requestRedaction(w, ["a"]), ["A"]);
});

test("bridge handler may be async", async () => {
  const w = fakeWindow();
  serveRedaction(w, async (t) => t.map((s) => s + "!"));
  assert.deepEqual(await requestRedaction(w, ["a", "b"]), ["a!", "b!"]);
});

test("bridge times out with no server", async () => {
  await assert.rejects(requestRedaction(fakeWindow(), ["a"], 50), /timed out/);
});

test("bridge rejects when handler throws", async () => {
  const w = fakeWindow();
  serveRedaction(w, () => { throw new Error("boom"); });
  await assert.rejects(requestRedaction(w, ["a"], 500), /boom/);
});

test("bridge failure reports", async () => {
  const w = fakeWindow();
  const got = new Promise((resolve) => onFailure(w, resolve));
  reportFailure(w, "bad");
  assert.equal(await got, "bad");
});
