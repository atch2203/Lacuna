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

test("non-string body passes through", async () => {
  const { win, calls, errors } = setup();
  const init = { method: "POST", body: new Uint8Array([1, 2]) };
  await win.fetch(URL_SEND, init);
  assert.equal(calls[0].init, init);
  assert.equal(errors.length, 0);
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
