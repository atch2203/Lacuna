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
