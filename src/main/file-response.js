// Is this fetch response a file the user will see (preview/download)?
// → "pdf" | "docx" | "text" | null. API JSON and streams are never files.

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXTLIKE = /^(text\/(?!event-stream)|application\/(json|csv|x-yaml|yaml|xml|markdown))/;

export function isRestorableFile(headers) {
  const type = (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type === DOCX) return "docx";
  const disposition = headers.get("content-disposition") ?? "";
  if (TEXTLIKE.test(type) && /filename/i.test(disposition)) return "text";
  return null;
}

function filenameOf(headers, url) {
  const cd = headers.get("content-disposition") ?? "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  try {
    return new URL(url, "https://x.invalid/").pathname.split("/").pop() || "file";
  } catch {
    return "file";
  }
}

// Wrap fetch so file responses come back with stand-ins restored.
// restore({ kind, name, buffer }) → Promise<Uint8Array | null> (null: unchanged).
// Fails open: any error returns the original response.
export function installFileRestorer({ win, restore }) {
  const originalFetch = win.fetch;
  win.fetch = async function (input, init) {
    const response = await originalFetch.call(this, input, init);
    let kind;
    try {
      kind = response.ok ? isRestorableFile(response.headers) : null;
    } catch {
      kind = null;
    }
    if (!kind) return response;
    try {
      const buffer = await response.clone().arrayBuffer();
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      const restored = await restore({ kind, name: filenameOf(response.headers, url), buffer });
      if (!restored) return response;
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(restored, { status: response.status, statusText: response.statusText, headers });
    } catch {
      return response;
    }
  };
}
