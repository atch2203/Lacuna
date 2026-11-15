// Final-review findings I3 (input event), I6 (detached targets), warnings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startFileInterceptor } from "../src/content/file-interceptor.js";

const file = (name, type = "application/pdf") => ({ name, type, size: 1 });
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeTarget(props = {}) {
  return { isConnected: true, dispatched: [], dispatchEvent(ev) { this.dispatched.push(ev); return true; }, ...props };
}

function setup({ processFile } = {}) {
  const win = new EventTarget();
  const warnings = [];
  const fallback = fakeTarget({ name: "fallback" });
  const doc = { elementFromPoint: () => fallback, activeElement: null, body: fakeTarget({ name: "body" }) };
  const calls = [];
  startFileInterceptor({
    win,
    doc,
    processFile:
      processFile ??
      (async (f) => {
        calls.push(f.name);
        return { status: "redacted", file: { ...f, redacted: true }, count: 1, warnings: [] };
      }),
    isEnabled: () => true,
    notify: { working: () => () => {}, warn: (m) => warnings.push(m) },
    isFileInput: (t) => t?.type === "file",
    setFiles: (input, files) => (input.files = files),
    makeEvent: (kind, type, init, files) => Object.assign(new Event(type), { kind, files }),
  });
  const pageSaw = [];
  for (const type of ["input", "change", "drop", "paste"]) win.addEventListener(type, (e) => pageSaw.push(type), true);
  return { win, doc, fallback, warnings, calls, pageSaw };
}

function fire(win, type, target, extra = {}) {
  const ev = new Event(type, { cancelable: true });
  Object.defineProperty(ev, "target", { value: target });
  Object.assign(ev, extra);
  win.dispatchEvent(ev);
  return ev;
}

test("input and change on a file input are both held; one redaction; files cleared meanwhile", async () => {
  const { win, calls, pageSaw } = setup();
  const input = fakeTarget({ type: "file", files: [file("a.pdf")] });
  fire(win, "input", input);
  assert.deepEqual(input.files, [], "originals cleared while redacting");
  fire(win, "change", input);
  assert.deepEqual(pageSaw, [], "page saw neither event");
  await tick();
  assert.deepEqual(calls, ["a.pdf"]);
  assert.equal(input.files[0].redacted, true);
  assert.deepEqual(input.dispatched.map((e) => e.type), ["input", "change"]);
});

test("drop target removed during redaction → re-dispatched at the drop point", async () => {
  const { win, fallback } = setup();
  const overlay = fakeTarget();
  fire(win, "drop", overlay, { dataTransfer: { files: [file("a.pdf")] }, clientX: 10, clientY: 20 });
  overlay.isConnected = false;
  await tick();
  assert.equal(overlay.dispatched.length, 0);
  assert.equal(fallback.dispatched[0].type, "drop");
});

test("paste target removed → re-dispatched on the body when nothing is focused", async () => {
  const { win, doc } = setup();
  const box = fakeTarget();
  fire(win, "paste", box, { clipboardData: { files: [file("a.pdf")] } });
  box.isConnected = false;
  await tick();
  assert.equal(doc.body.dispatched[0].type, "paste");
});

test("handler warnings are shown", async () => {
  const { win, warnings } = setup({
    processFile: async (f) => ({ status: "redacted", file: f, count: 0, warnings: ["contains 1 embedded object that was not redacted"] }),
  });
  fire(win, "change", fakeTarget({ type: "file", files: [file("a.docx", "")] }));
  await tick();
  assert.deepEqual(warnings, ["a.docx: contains 1 embedded object that was not redacted"]);
});
