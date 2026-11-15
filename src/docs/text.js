// Text-like files: decode UTF-8, redact the whole text, re-encode.
import { applySpans } from "./router.js";

export async function redactText(bytes, redactSpans) {
  const text = new TextDecoder().decode(bytes);
  const [spans] = await redactSpans([text]);
  return { bytes: new TextEncoder().encode(applySpans(text, spans)), count: spans.length };
}
