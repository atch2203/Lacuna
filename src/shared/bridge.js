// postMessage protocol between the MAIN-world fetch hook and the
// ISOLATED-world content script. Both worlds share one window, so every
// message reaches both sides; each side filters by `type`.

const SOURCE = "llm-redactor";
const REQUEST = "redact-request";
const RESPONSE = "redact-response";
const FAILURE = "failure";

// Returns an unsubscribe function.
function listen(win, type, cb) {
  const handler = (event) => {
    const data = event.data;
    if (event.source !== win || !data || data.source !== SOURCE || data.type !== type) return;
    cb(data);
  };
  win.addEventListener("message", handler);
  return () => win.removeEventListener("message", handler);
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function requestRedaction(win, texts, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const id = newId();
    let done = false;
    let unlisten = () => {};
    const timer = setTimeout(() => {
      done = true;
      unlisten();
      reject(new Error(`redaction timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    unlisten = listen(win, RESPONSE, (data) => {
      if (done || data.id !== id) return;
      done = true;
      clearTimeout(timer);
      unlisten();
      if (data.error) reject(new Error(data.error));
      else resolve(data.texts);
    });
    win.postMessage({ source: SOURCE, type: REQUEST, id, texts }, "*");
  });
}

export function serveRedaction(win, handler) {
  listen(win, REQUEST, async ({ id, texts }) => {
    try {
      const out = await handler(texts);
      win.postMessage({ source: SOURCE, type: RESPONSE, id, texts: out }, "*");
    } catch (err) {
      win.postMessage({ source: SOURCE, type: RESPONSE, id, error: String(err?.message ?? err) }, "*");
    }
  });
}

export function reportFailure(win, reason) {
  win.postMessage({ source: SOURCE, type: FAILURE, reason }, "*");
}

export function onFailure(win, cb) {
  listen(win, FAILURE, (data) => cb(data.reason));
}
