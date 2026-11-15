import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreClipboardText, handleCopy, wrapClipboard, performClipboardWrite } from "../src/demo/clipboard.js";

const entries = [["[API_KEY_1]", "AKIAIOSFODNN7EXAMPLE"], ["jordan.lee@example.com", "jane@corp.io"]];
const restore = (t) => restoreClipboardText(t, entries);

test("restoreClipboardText swaps stand-ins and counts them", () => {
  assert.deepEqual(restore("mail jordan.lee@example.com key [API_KEY_1]"), {
    text: "mail jane@corp.io key AKIAIOSFODNN7EXAMPLE",
    count: 2,
  });
  assert.deepEqual(restore("nothing here"), { text: "nothing here", count: 0 });
});

function copyEvent(preset) {
  const data = new Map(preset ? [["text/plain", preset]] : []);
  return {
    defaultPrevented: Boolean(preset),
    prevented: false,
    clipboardData: { getData: (t) => data.get(t) ?? "", setData: (t, v) => data.set(t, v) },
    preventDefault() { this.prevented = true; },
    data,
  };
}

test("copy of selected stand-ins puts real values on the clipboard", () => {
  const ev = copyEvent();
  const n = handleCopy(ev, { getSelectionText: () => "key [API_KEY_1]", restore });
  assert.equal(n, 1);
  assert.equal(ev.prevented, true);
  assert.equal(ev.data.get("text/plain"), "key AKIAIOSFODNN7EXAMPLE");
});

test("copy with no stand-ins leaves the event alone", () => {
  const ev = copyEvent();
  assert.equal(handleCopy(ev, { getSelectionText: () => "plain text", restore }), 0);
  assert.equal(ev.prevented, false);
  assert.equal(ev.data.size, 0);
});

test("page-set clipboard data is restored instead of the selection", () => {
  const ev = copyEvent("**[API_KEY_1]**");
  handleCopy(ev, { getSelectionText: () => "selection [API_KEY_1] ignored", restore });
  assert.equal(ev.data.get("text/plain"), "**AKIAIOSFODNN7EXAMPLE**");
});

// The page-side wrapper must never receive restored text (any page could
// otherwise read real values by writing stand-ins). It hands the request to
// the isolated side and only learns whether it was handled.
test("writeText: handled by the isolated side → page's original call skipped", async () => {
  const written = [];
  const requests = [];
  const clipboard = { writeText: async (t) => written.push(t) };
  wrapClipboard(clipboard, async (req) => (requests.push(req), true));
  const result = await clipboard.writeText("key [API_KEY_1]");
  assert.deepEqual(requests, [{ kind: "text", text: "key [API_KEY_1]" }]);
  assert.deepEqual(written, []);
  assert.equal(result, undefined);
});

test("writeText: not handled → original call with the page's own text", async () => {
  const written = [];
  const clipboard = { writeText: async (t) => written.push(t) };
  wrapClipboard(clipboard, async () => false);
  await clipboard.writeText("plain");
  assert.deepEqual(written, ["plain"]);
});

test("write: items are sent as parts (strings for text types, blobs otherwise)", async () => {
  class FakeItem {
    constructor(parts) { this.parts = parts; this.types = Object.keys(parts); }
    async getType(t) { return this.parts[t]; }
  }
  const requests = [];
  const clipboard = { writeText: async () => {}, write: async () => assert.fail("should be handled") };
  wrapClipboard(clipboard, async (req) => (requests.push(req), true));
  const png = new Blob(["png"], { type: "image/png" });
  await clipboard.write([new FakeItem({ "text/plain": new Blob(["[API_KEY_1]"]), "image/png": png })]);
  assert.deepEqual(requests[0].kind, "items");
  assert.equal(requests[0].items[0]["text/plain"], "[API_KEY_1]");
  assert.equal(requests[0].items[0]["image/png"], png);
});

test("performClipboardWrite restores text and writes real values itself", async () => {
  const writes = [];
  const clipboard = { writeText: async (t) => writes.push(t) };
  const handled = await performClipboardWrite({ kind: "text", text: "key [API_KEY_1]" }, { restore, clipboard });
  assert.equal(handled, 1);
  assert.deepEqual(writes, ["key AKIAIOSFODNN7EXAMPLE"]);
});

test("performClipboardWrite with no stand-ins does nothing", async () => {
  const clipboard = { writeText: async () => assert.fail("no write") };
  assert.equal(await performClipboardWrite({ kind: "text", text: "plain" }, { restore, clipboard }), 0);
});

test("performClipboardWrite rebuilds items with restored text/plain and text/html", async () => {
  class FakeItem { constructor(parts) { this.parts = parts; } }
  const writes = [];
  const clipboard = { write: async (items) => writes.push(...items) };
  const png = new Blob(["png"], { type: "image/png" });
  const handled = await performClipboardWrite(
    { kind: "items", items: [{ "text/plain": "[API_KEY_1]", "text/html": "<b>[API_KEY_1]</b>", "image/png": png }] },
    { restore, clipboard, ClipboardItem: FakeItem, Blob },
  );
  assert.equal(handled, 2);
  const parts = writes[0].parts;
  assert.equal(await parts["text/plain"].text(), "AKIAIOSFODNN7EXAMPLE");
  assert.equal(await parts["text/html"].text(), "<b>AKIAIOSFODNN7EXAMPLE</b>");
  assert.equal(parts["image/png"], png);
});

// --- final review ------------------------------------------------------------
test("I3: page-set text/html is restored too", () => {
  const data = new Map([["text/plain", "[API_KEY_1]"], ["text/html", "<b>[API_KEY_1]</b>"]]);
  const ev = {
    defaultPrevented: true,
    clipboardData: { getData: (t) => data.get(t) ?? "", setData: (t, v) => data.set(t, v) },
    preventDefault() {},
  };
  handleCopy(ev, { getSelectionText: () => "", restore });
  assert.equal(data.get("text/html"), "<b>AKIAIOSFODNN7EXAMPLE</b>");
});

test("I3: selection copy keeps formatting (restored html from the selection)", () => {
  const data = new Map();
  const ev = {
    defaultPrevented: false,
    clipboardData: { getData: (t) => data.get(t) ?? "", setData: (t, v) => data.set(t, v) },
    preventDefault() {},
  };
  handleCopy(ev, { getSelectionText: () => "key [API_KEY_1]", getSelectionHtml: () => "key <i>[API_KEY_1]</i>", restore });
  assert.equal(data.get("text/html"), "key <i>AKIAIOSFODNN7EXAMPLE</i>");
});

test("M4: page blocked copying (preventDefault, no data) → left blocked", () => {
  const data = new Map();
  const ev = {
    defaultPrevented: true,
    clipboardData: { getData: () => "", setData: (t, v) => data.set(t, v) },
    preventDefault() {},
  };
  assert.equal(handleCopy(ev, { getSelectionText: () => "[API_KEY_1]", restore }), 0);
  assert.equal(data.size, 0);
});

test("M2: write() falls back to the original when reading items fails", async () => {
  const written = [];
  const clipboard = { write: async (items) => written.push(items) };
  wrapClipboard(clipboard, async () => assert.fail("not reached"));
  const bad = { types: ["text/plain"], getType: async () => { throw new Error("boom"); } };
  await clipboard.write([bad]);
  assert.equal(written.length, 1);
});
