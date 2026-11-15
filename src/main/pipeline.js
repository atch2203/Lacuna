// Shared request-redaction steps for the fetch and XHR hooks.

export function findAdapter(adapters, url, method) {
  return adapters.find((a) => a.matches(url, method));
}

// Normalize a request body to a string the adapters can read, plus a
// function that converts a redacted string back to the original body type
// (so e.g. URLSearchParams keeps its Content-Type). null = unreadable.
export function readableBody(body) {
  if (typeof body === "string") return { text: body, wrap: (s) => s };
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return { text: body.toString(), wrap: (s) => new URLSearchParams(s) };
  }
  return null;
}

// Returns the redacted body text, or null when nothing changed.
export async function redactBody(adapter, text, redactTexts) {
  const texts = adapter.extract(text);
  if (texts.length === 0) return null;
  const redacted = await redactTexts(texts);
  if (redacted.every((t, i) => t === texts[i])) return null;
  return adapter.inject(text, redacted);
}
