// MAIN-world entry: wraps fetch and XHR before the page's own scripts run.
import { installFetchHook } from "./fetch-hook.js";
import { installXhrHook } from "./xhr-hook.js";
import { ADAPTERS } from "./adapters/index.js";
import { requestRedaction, reportFailure } from "../shared/bridge.js";
import { installFileRestorer } from "./file-response.js";
import { createPickerRedactor, installFilePickerHook } from "./file-picker-hook.js";

const hookOptions = {
  win: window,
  adapters: ADAPTERS,
  redactTexts: (texts) => requestRedaction(window, texts),
  onError: (reason) => reportFailure(window, reason),
};

installFetchHook(hookOptions);
installXhrHook(hookOptions);

// Files the model generates come back with stand-ins; restore them for the
// user. The bytes go to the extension (transferred) and come back restored.
const FILE = "llm-redactor-file";
const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text: "text/plain" };
installFileRestorer({
  win: window,
  restore: ({ kind, name, buffer }) =>
    new Promise((resolve) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => done(null), 60_000);
      function done(result) {
        clearTimeout(timer);
        window.removeEventListener("message", onReply);
        resolve(result);
      }
      function onReply(event) {
        const msg = event.data;
        if (event.source === window && msg?.source === FILE && msg.type === "restored" && msg.id === id) {
          done(msg.buffer ? new Uint8Array(msg.buffer) : null);
        }
      }
      window.addEventListener("message", onReply);
      window.postMessage({ source: FILE, type: "restore", id, name, mime: MIME[kind], buffer }, "*", [buffer]);
    }),
});

installFilePickerHook({
  redact: createPickerRedactor(window),
});
