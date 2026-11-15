// Wraps XMLHttpRequest so prompt requests sent via XHR (e.g. Closure-based
// sites) get the same redaction as fetch. Async sends are held until
// redaction finishes; synchronous ones can't wait and fail open with a warning.
import { findAdapter, readableBody, redactBody } from "./pipeline.js";

export function installXhrHook({ win, adapters, redactTexts, onError }) {
  const proto = win.XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const meta = new WeakMap();

  proto.open = function (method, url, async = true, ...rest) {
    meta.set(this, { method: String(method).toUpperCase(), url: String(url), async: async !== false });
    return originalOpen.call(this, method, url, async, ...rest);
  };

  proto.send = function (body) {
    const m = meta.get(this);
    let adapter;
    try {
      if (m) adapter = findAdapter(adapters, new URL(m.url, win.location?.href), m.method);
    } catch {
      adapter = undefined;
    }
    if (!adapter || body === undefined || body === null) return originalSend.call(this, body);

    if (!m.async) {
      onError(`${adapter.id}: synchronous XHR can't be redacted`);
      return originalSend.call(this, body);
    }

    const readable = readableBody(body, adapter.bodyType);
    if (!readable) {
      onError(`${adapter.id}: unreadable request body (${Object.prototype.toString.call(body)})`);
      return originalSend.call(this, body);
    }

    redactBody(adapter, readable.value, redactTexts)
      .then((redacted) => originalSend.call(this, redacted === null ? body : readable.wrap(redacted)))
      .catch((err) => {
        onError(`${adapter.id}: ${err?.message ?? err}`);
        originalSend.call(this, body);
      });
  };
}
