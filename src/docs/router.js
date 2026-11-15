// Routes an attached file to the right format handler.
//
// RedactSpans = (texts: string[]) => Promise<Array<Array<{start,end,standIn}>>>
// Handler     = (bytes, redactSpans) => Promise<{ bytes, count, status? }>

const MAX_BYTES = 50 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "log",
  "js", "ts", "jsx", "tsx", "py", "java", "c", "cc", "cpp", "h", "hpp", "cs",
  "go", "rs", "rb", "php", "sh", "sql", "html", "css",
]);

function extensionOf(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function classifyFile({ name, type }) {
  if (type === "application/pdf") return "pdf";
  if (type === DOCX_MIME) return "docx";
  if (type?.startsWith("text/") || type === "application/json") return "text";
  const ext = extensionOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return null;
}

// Splice non-overlapping, sorted spans into text.
export function applySpans(text, spans) {
  const parts = [];
  let cursor = 0;
  for (const { start, end, standIn } of spans) {
    parts.push(text.slice(cursor, start), standIn);
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

export async function redactFile({ name, type, bytes }, redactSpans, handlers) {
  if (bytes.length > MAX_BYTES) throw new Error("file exceeds 50 MB");
  const kind = classifyFile({ name, type });
  if (!kind) return { status: "unsupported", bytes, count: 0 };
  const out = await handlers[kind](bytes, redactSpans);
  return { status: out.status ?? "redacted", bytes: out.bytes, count: out.count };
}
