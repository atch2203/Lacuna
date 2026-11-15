// Wraps window.fetch so prompt-bearing requests are redacted before they
// leave the page. Fails open: any error forwards the original request.

// Adapter = { id, matches(url: URL, method), extract(body) → string[], inject(body, texts) → body }

async function describe(input, init) {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const url = new URL(isRequest ? input.url : String(input), globalThis.location?.href);
  const method = (init?.method ?? (isRequest ? input.method : "GET")).toUpperCase();
  let body;
  let bodyFrom = null;
  if (init?.body !== undefined) {
    body = init.body;
    bodyFrom = "init";
  } else if (isRequest && method !== "GET" && method !== "HEAD") {
    body = await input.clone().text();
    bodyFrom = "request";
  }
  return { url, method, body, bodyFrom };
}

function rebuild(input, init, bodyFrom, newBody) {
  if (bodyFrom === "init") return [input, { ...init, body: newBody }];
  return [new Request(input, { body: newBody }), init];
}

export function installFetchHook({ win, adapters, redactTexts, onError }) {
  const originalFetch = win.fetch.bind(win);

  win.fetch = async function (input, init) {
    let adapter;
    let req;
    try {
      req = await describe(input, init);
      adapter = adapters.find((a) => a.matches(req.url, req.method));
    } catch {
      adapter = undefined;
    }
    if (!adapter || typeof req.body !== "string") return originalFetch(input, init);

    try {
      const texts = adapter.extract(req.body);
      if (texts.length === 0) return originalFetch(input, init);
      const redacted = await redactTexts(texts);
      if (redacted.every((t, i) => t === texts[i])) return originalFetch(input, init);
      const newBody = adapter.inject(req.body, redacted);
      return originalFetch(...rebuild(input, init, req.bodyFrom, newBody));
    } catch (err) {
      onError(`${adapter.id}: ${err?.message ?? err}`);
      return originalFetch(input, init);
    }
  };
}
