// Wraps window.fetch so prompt-bearing requests are redacted before they
// leave the page. Fails open: any error forwards the original request and
// calls onError (which shows the warning badge).

// Adapter = { id, matches(url: URL, method), extract(body) → string[], inject(body, texts) → body }
import { findAdapter, readableBody, redactBody } from "./pipeline.js";

function target(input, init, baseHref) {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const url = new URL(isRequest ? input.url : String(input), baseHref);
  const method = (init?.method ?? (isRequest ? input.method : "GET")).toUpperCase();
  return { url, method, isRequest };
}

export function installFetchHook({ win, adapters, redactTexts, onError }) {
  const originalFetch = win.fetch.bind(win);

  win.fetch = async function (input, init) {
    let adapter;
    let isRequest;
    try {
      const t = target(input, init, win.location?.href ?? globalThis.location?.href);
      isRequest = t.isRequest;
      adapter = findAdapter(adapters, t.url, t.method);
    } catch {
      adapter = undefined;
    }
    if (!adapter) return originalFetch(input, init);

    try {
      // Read the body only once we know this is a prompt request.
      const fromInit = init?.body !== undefined;
      const raw = fromInit ? init.body : isRequest ? await input.clone().text() : undefined;
      if (raw === undefined) return originalFetch(input, init);
      const body = readableBody(raw);
      if (!body) throw new Error(`unreadable request body (${Object.prototype.toString.call(raw)})`);

      const redacted = await redactBody(adapter, body.text, redactTexts);
      if (redacted === null) return originalFetch(input, init);
      const newBody = body.wrap(redacted);
      if (fromInit) return originalFetch(input, { ...init, body: newBody });
      return originalFetch(new Request(input, { body: newBody }), init);
    } catch (err) {
      onError(`${adapter.id}: ${err?.message ?? err}`);
      return originalFetch(input, init);
    }
  };
}
