// DOM-level tests for screen-guard.js (happy-dom): I3 shadow roots, I8 inputs
// set from code, plus the basic swap/restore path.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";
let win;
let startScreenGuard;
const GLOBALS = ["window", "document", "Node", "NodeFilter", "MutationObserver", "HTMLElement", "requestAnimationFrame", "cancelAnimationFrame", "Event", "CustomEvent", "getComputedStyle"];
const saved = {};

before(async () => {
  win = new Window({ url: "https://example.com/" });
  for (const k of GLOBALS) {
    saved[k] = globalThis[k];
    const v = win[k] ?? win.window[k];
    Object.defineProperty(globalThis, k, { value: typeof v === "function" && k === "getComputedStyle" ? v.bind(win) : v, configurable: true, writable: true });
  }
  ({ startScreenGuard } = await import("../src/guard/screen-guard.js"));
});

after(() => {
  for (const k of GLOBALS) Object.defineProperty(globalThis, k, { value: saved[k], configurable: true, writable: true });
  win.close();
});

const flush = () => new Promise((r) => setTimeout(r, 40));

function start(known = { [KEY]: "[API_KEY_1]" }) {
  return startScreenGuard({
    getDetectors: () => PATTERN_DETECTORS,
    lookup: (o) => known[o],
    isStandIn: () => false,
    requestStandIns: () => {},
    root: document.documentElement,
  });
}

test("swaps page text and restores it", async () => {
  document.body.innerHTML = `<p id="p">key ${KEY}</p>`;
  const g = start();
  assert.equal(document.getElementById("p").textContent, "key [API_KEY_1]");
  g.stop();
  assert.equal(document.getElementById("p").textContent, `key ${KEY}`);
});

test("text inside an existing open shadow root is guarded", async () => {
  document.body.innerHTML = `<div id="host"></div>`;
  const root = document.getElementById("host").attachShadow({ mode: "open" });
  root.innerHTML = `<span>key ${KEY}</span>`;
  const g = start();
  assert.equal(root.querySelector("span").textContent, "key [API_KEY_1]");
  root.querySelector("span").textContent = `again ${KEY}`;
  await flush();
  assert.equal(root.querySelector("span").textContent, "again [API_KEY_1]", "mutations inside the shadow root observed");
  g.stop();
});

test("shadow root attached later is guarded once announced", async () => {
  document.body.innerHTML = `<div id="host2"></div>`;
  const g = start();
  const host = document.getElementById("host2");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<b>key ${KEY}</b>`;
  host.dispatchEvent(new CustomEvent("llm-redactor-shadow-attached", { bubbles: true, composed: true }));
  await flush();
  assert.equal(root.querySelector("b").textContent, "key [API_KEY_1]");
  g.stop();
});

test("input value set from code gets a stand-in mirror, removed on stop", async () => {
  document.body.innerHTML = `<input id="k" value="nothing">`;
  const g = start();
  const input = document.getElementById("k");
  input.value = KEY; // no input event
  await flush();
  assert.equal(document.querySelector('[data-llm-redactor="mirror"]')?.textContent, "[API_KEY_1]");
  g.stop();
  assert.equal(document.querySelector('[data-llm-redactor="mirror"]'), null);
  assert.equal(input.style.getPropertyValue("color"), "");
});

test("pasting a real value into a textarea during a share shows a stand-in", async () => {
  document.body.innerHTML = `<textarea id="t"></textarea>`;
  const g = start();
  const ta = document.getElementById("t");
  ta.value = `here is ${KEY}`; // what a paste does
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(document.querySelector('[data-llm-redactor="mirror"]')?.textContent, "here is [API_KEY_1]");
  assert.equal(ta.value, `here is ${KEY}`, "editable content is never rewritten");
  g.stop();
});

test("pasted text rendered as page text is guarded", async () => {
  document.body.innerHTML = `<div id="out"></div>`;
  const g = start();
  document.getElementById("out").append(document.createTextNode(`pasted ${KEY}`));
  await flush();
  assert.equal(document.getElementById("out").textContent, "pasted [API_KEY_1]");
  g.stop();
});

// --- field mirror (user asked for stand-ins in text boxes instead of blur) ---
test("text box with a sensitive value shows stand-ins via a mirror; value untouched", async () => {
  document.body.innerHTML = `<textarea id="m">key ${KEY}</textarea>`;
  const g = start();
  await flush();
  const ta = document.getElementById("m");
  assert.equal(ta.value, `key ${KEY}`, "real value kept");
  assert.equal(ta.style.getPropertyValue("filter"), "", "no blur on text boxes");
  assert.match(ta.style.getPropertyValue("color"), /transparent/);
  const mirror = document.querySelector('[data-llm-redactor="mirror"]');
  assert.ok(mirror, "mirror exists");
  assert.equal(mirror.textContent, "key [API_KEY_1]");
  ta.value = `now ${KEY}!`;
  await flush();
  assert.equal(mirror.textContent, "now [API_KEY_1]!", "mirror follows the value");
  g.stop();
  assert.equal(ta.style.getPropertyValue("color"), "");
  assert.equal(document.querySelector('[data-llm-redactor="mirror"]'), null);
});

test("text box without sensitive values gets no mirror", async () => {
  document.body.innerHTML = `<input id="plain" value="hello">`;
  const g = start();
  await flush();
  assert.equal(document.querySelector('[data-llm-redactor="mirror"]'), null);
  g.stop();
});

test("password inputs are left alone", async () => {
  document.body.innerHTML = `<input type="password" id="pw" value="${KEY}">`;
  const g = start();
  await flush();
  assert.equal(document.querySelector('[data-llm-redactor="mirror"]'), null);
  assert.equal(document.getElementById("pw").style.getPropertyValue("filter"), "");
  g.stop();
});

test("rich editors (contenteditable) are still blurred", async () => {
  document.body.innerHTML = `<div contenteditable="true" id="ed">key ${KEY}</div>`;
  const g = start();
  await flush();
  assert.match(document.getElementById("ed").style.getPropertyValue("filter"), /blur/);
  g.stop();
});
