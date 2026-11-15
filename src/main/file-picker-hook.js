// Wraps the File System Access picker used by some chat UIs. The page keeps
// its original handles, but getFile() returns the redacted file.
const SOURCE = "llm-redactor-file";

export function installFilePickerHook({ win = window, redact }) {
  if (typeof win.showOpenFilePicker !== "function") return;
  const original = win.showOpenFilePicker.bind(win);

  win.showOpenFilePicker = async function (...args) {
    const handles = await original(...args);
    return Promise.all(
      handles.map(async (handle) => {
        const file = await handle.getFile();
        const redacted = await redact(file);
        if (!redacted) return handle;
        return new Proxy(handle, {
          get(target, property) {
            if (property === "getFile") return async () => redacted;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }),
    );
  };
}

export function createPickerRedactor(win = window) {
  const pending = new Map();
  let sequence = 0;

  win.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== win || msg?.source !== SOURCE || msg.type !== "picker-result") return;
    const resolve = pending.get(msg.id);
    if (!resolve) return;
    pending.delete(msg.id);
    resolve(msg);
  });

  return async (file) => {
    const id = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    const buffer = await file.arrayBuffer();
    const result = await new Promise((resolve) => {
      pending.set(id, resolve);
      win.postMessage(
        { source: SOURCE, type: "picker-redact", id, name: file.name, mime: file.type, lastModified: file.lastModified, buffer },
        "*",
        [buffer],
      );
    });
    if (result.status !== "redacted" || !result.buffer) return null;
    return new File([result.buffer], file.name, { type: file.type, lastModified: file.lastModified });
  };
}
