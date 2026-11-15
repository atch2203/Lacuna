// Plain (non-module) bootstrap: reports document-frame startup failures to
// the page even if the main module fails to load or evaluate.
(() => {
  const SOURCE = "llm-redactor-docframe";
  const ALLOWED = ["https://claude.ai", "https://chatgpt.com", "https://gemini.google.com"];
  const parentOrigin = location.ancestorOrigins && location.ancestorOrigins[0];
  const report = (error) => {
    if (ALLOWED.includes(parentOrigin)) {
      window.parent.postMessage({ source: SOURCE, type: "frame-error", error: String(error) }, parentOrigin);
    }
  };
  window.addEventListener("error", (e) => report(e.message || (e.target && e.target.src ? `failed to load ${e.target.src}` : "error")), true);
  window.addEventListener("unhandledrejection", (e) => report((e.reason && e.reason.message) || e.reason));
})();
