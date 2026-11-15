// Text-like files: decode, redact the whole text, re-encode in the same
// encoding. UTF-16 (LE/BE, with BOM) and UTF-8 (BOM kept) are supported;
// anything that isn't valid UTF-8 is rejected so the caller fails open with
// a visible warning instead of silently corrupting or under-redacting it.
import { applySpans, swapsFor } from "./router.js";

function detect(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf-16le", bom: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: "utf-16be", bom: 2 };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: "utf-8", bom: 3 };
  return { encoding: "utf-8", bom: 0 };
}

function encode(text, encoding) {
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const [lo, hi] = [c & 0xff, c >> 8];
    out[2 * i] = encoding === "utf-16le" ? lo : hi;
    out[2 * i + 1] = encoding === "utf-16le" ? hi : lo;
  }
  return out;
}

export async function redactText(bytes, redactSpans) {
  const { encoding, bom } = detect(bytes);
  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom));
  } catch {
    throw new Error(`file is not valid ${encoding === "utf-8" ? "UTF-8" : encoding.toUpperCase()}`);
  }
  const [spans] = await redactSpans([text]);
  const body = encode(applySpans(text, spans), encoding);
  const out = new Uint8Array(bom + body.length);
  out.set(bytes.subarray(0, bom));
  out.set(body, bom);
  return { bytes: out, count: spans.length, swaps: swapsFor(text, spans) };
}
