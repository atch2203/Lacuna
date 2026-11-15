// Content-script side of the document frame: injects the hidden iframe once
// and sends files to it (ArrayBuffer transferred, not copied).

const SOURCE = "llm-redactor-docframe";
const TIMEOUT_MS = 60_000;

let framePromise = null;
const pending = new Map();

function getFrame() {
  framePromise ??= new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("docframe.html");
    iframe.setAttribute("data-llm-redactor", "docframe");
    iframe.style.display = "none";
    const timer = setTimeout(() => reject(new Error("document frame did not load")), TIMEOUT_MS);

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (event.source !== iframe.contentWindow || !msg || msg.source !== SOURCE) return;
      if (msg.type === "ready") {
        clearTimeout(timer);
        resolve(iframe);
      } else if (msg.type === "result") {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      }
    });
    document.documentElement.appendChild(iframe);
  });
  framePromise.catch(() => (framePromise = null));
  return framePromise;
}

// → { status: "redacted"|"unsupported"|"no-text", file: File, count }
export async function redactInFrame(file) {
  const iframe = await getFrame();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const buffer = await file.arrayBuffer();

  const msg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timed out"));
    }, TIMEOUT_MS);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    iframe.contentWindow.postMessage(
      { source: SOURCE, type: "redact", id, name: file.name, mime: file.type, buffer },
      new URL(iframe.src).origin,
      [buffer],
    );
  });

  if (msg.error) throw new Error(msg.error);
  if (msg.status !== "redacted") return { status: msg.status, file, count: 0 };
  const out = new File([msg.buffer], file.name, { type: file.type, lastModified: file.lastModified });
  return { status: "redacted", file: out, count: msg.count };
}
