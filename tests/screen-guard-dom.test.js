// DOM-level tests for screen-guard.js (happy-dom): I3 shadow roots, I8 inputs
// set from code, plus the basic swap/restore path.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { PATTERN_DETECTORS } from "../src/engine/patterns.js";

const KEY = "AKIAIOSFODNN7EXAMPLE";
let win;
let startScreenGuard;
const GLOBALS = ["window", "document", "Node", "NodeFilter", "MutationObserver", "HTMLElement", "requestAnimationFrame", "cancelAnimationFrame", "Event", "CustomEvent"];
const saved = {};

before(async () => {
  win = new Window({ url: "https://example.com/" });
  for (const k of GLOBALS) {
    saved[k] = globalThis[k];
    Object.defineProperty(globalThis, k, { value: win[k] ?? win.window[k], configurable: true, writable: true });
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

test("input value set from code is blurred (inline style) and unblurred on stop", async () => {
  document.body.innerHTML = `<input id="k" value="nothing">`;
  const g = start();
  const input = document.getElementById("k");
  assert.equal(input.style.getPropertyValue("filter"), "");
  input.value = KEY; // no input event
  await flush();
  assert.match(input.style.getPropertyValue("filter"), /blur/);
  g.stop();
  assert.equal(input.style.getPropertyValue("filter"), "");
});

test("pasting a real value into a textarea during a share blurs it", async () => {
  document.body.innerHTML = `<textarea id="t"></textarea>`;
  const g = start();
  const ta = document.getElementById("t");
  ta.value = `here is ${KEY}`; // what a paste does
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  assert.match(ta.style.getPropertyValue("filter"), /blur/);
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
