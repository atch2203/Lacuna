// Shared request-redaction steps for the fetch and XHR hooks.
//
// Adapters declare bodyType: "text" (default) or "bytes". Text adapters get
// a string; bytes adapters get a Uint8Array (e.g. application/proto bodies).

export function findAdapter(adapters, url, method) {
  return adapters.find((a) => a.matches(url, method));
}

// Normalize a request body to what the adapter reads, plus a function that
// converts the adapter's output back to a sendable body of the original kind
// (so e.g. URLSearchParams keeps its Content-Type). null = unreadable.
export function readableBody(body, bodyType = "text") {
  if (bodyType === "bytes") {
    if (body instanceof Uint8Array) return { value: body, wrap: (b) => b };
    if (body instanceof ArrayBuffer) return { value: new Uint8Array(body), wrap: (b) => b };
    if (ArrayBuffer.isView(body)) {
      return { value: new Uint8Array(body.buffer, body.byteOffset, body.byteLength), wrap: (b) => b };
    }
    return null;
  }
  if (typeof body === "string") return { value: body, wrap: (s) => s };
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return { value: body.toString(), wrap: (s) => new URLSearchParams(s) };
  }
  return null;
}

// Read a fetch Request's body in the adapter's format.
export async function readRequestBody(request, bodyType = "text") {
  const clone = request.clone();
  return bodyType === "bytes" ? new Uint8Array(await clone.arrayBuffer()) : clone.text();
}

// Returns the redacted body, or null when nothing changed.
export async function redactBody(adapter, body, redactTexts) {
  const texts = adapter.extract(body);
  if (texts.length === 0) return null;
  const redacted = await redactTexts(texts);
  if (redacted.every((t, i) => t === texts[i])) return null;
  return adapter.inject(body, redacted);
}
