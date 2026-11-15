// Ghost clipboard: when copied text contains stand-ins, put the real values
// on the clipboard instead.
import { makeRestorer } from "../engine/restore.js";

// entries: Array<[standIn, original]>
export function restoreClipboardText(text, entries) {
  const restore = makeRestorer(entries);
  const count = restore.standInsIn(text).length;
  return { text: count ? restore(text) : text, count };
}

// copy event, handled after the page's own handlers. If the page set
// clipboard data, restore that (text and html); if it blocked copying
// (preventDefault without data), leave it blocked; otherwise restore the
// selection. restore(text) → { text, count }. Returns values restored.
export function handleCopy(event, { getSelectionText, getSelectionHtml = () => "", restore }) {
  let plain;
  let html;
  if (event.defaultPrevented) {
    plain = event.clipboardData?.getData("text/plain") ?? "";
    html = event.clipboardData?.getData("text/html") ?? "";
    if (!plain && !html) return 0;
  } else {
    plain = getSelectionText() ?? "";
    html = getSelectionHtml() ?? "";
  }
  const p = restore(plain);
  const h = restore(html);
  if (!p.count && !h.count) return 0;
  event.clipboardData.setData("text/plain", p.text);
  if (html) event.clipboardData.setData("text/html", h.text);
  event.preventDefault();
  return Math.max(p.count, h.count);
}

// PAGE side (MAIN world): wrap navigator.clipboard so site "copy" buttons go
// through the extension. The wrapper never receives restored text — any page
// could otherwise read real values by writing stand-ins. delegate(request)
// → Promise<handled>; when handled, the isolated side already wrote the
// clipboard and the page's own write is skipped.
//   request = { kind: "text", text } | { kind: "items", items: Array<{ [type]: string | Blob }> }
export function wrapClipboard(clipboard, delegate) {
  const originalWriteText = clipboard.writeText?.bind(clipboard);
  const originalWrite = clipboard.write?.bind(clipboard);

  if (originalWriteText) {
    clipboard.writeText = async (text) => {
      if (await delegate({ kind: "text", text: String(text) }).catch(() => false)) return undefined;
      return originalWriteText(text);
    };
  }

  if (originalWrite) {
    clipboard.write = async (items) => {
      let parts;
      try {
        parts = await Promise.all(
          [...items].map(async (item) => {
            const out = {};
            for (const type of item.types) {
              const blob = await item.getType(type);
              out[type] = type === "text/plain" || type === "text/html" ? await blob.text() : blob;
            }
            return out;
          }),
        );
      } catch {
        return originalWrite(items); // never break the site's copy button
      }
      if (await delegate({ kind: "items", items: parts }).catch(() => false)) return undefined;
      return originalWrite(items);
    };
  }
}

// EXTENSION side (ISOLATED world): restore stand-ins and write the real values
// with the extension's own (unwrapped) clipboard. Returns the number of values
// restored; 0 means nothing to do (the page writes its own text).
export async function performClipboardWrite(request, { restore, clipboard, ClipboardItem = globalThis.ClipboardItem, Blob = globalThis.Blob }) {
  if (request.kind === "text") {
    const { text, count } = restore(request.text);
    if (!count) return 0;
    await clipboard.writeText(text);
    return count;
  }
  let total = 0;
  const items = request.items.map((parts) => {
    const out = {};
    for (const [type, value] of Object.entries(parts)) {
      if (typeof value === "string") {
        const { text, count } = restore(value);
        total += count;
        out[type] = new Blob([text], { type });
      } else {
        out[type] = value;
      }
    }
    return out;
  });
  if (!total) return 0;
  await clipboard.write(items.map((parts) => new ClipboardItem(parts)));
  return total;
}
