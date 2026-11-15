// Catches files the user attaches (file picker, drag-and-drop, paste) before
// the page's own listeners run, redacts them, then re-dispatches the event
// with the redacted files. Fails open: on error the original file is used.
import { classifyFile } from "../docs/router.js";

// processFile: (File) => Promise<{ status, file, count }>
// notify: { working(name) => update(kind, message, timeoutMs), warn(message) }
const log = (...args) => console.debug("[llm-redactor files]", ...args);

export function startFileInterceptor({ processFile, isEnabled, notify }) {
  const ours = new WeakSet();

  async function redactAll(files) {
    return Promise.all(
      files.map(async (file) => {
        if (!classifyFile(file)) {
          notify.warn(`${file.name} attached unredacted (unsupported type)`);
          return file;
        }
        const update = notify.working(`Redacting ${file.name}…`);
        try {
          const out = await processFile(file);
          if (out.status === "no-text") {
            update("warn", `${file.name} has no text layer — attached unredacted`, 0);
          } else if (out.status === "unsupported") {
            update("warn", `${file.name} attached unredacted (unsupported type)`, 0);
          } else {
            update("info", `Redacted ${out.count} item${out.count === 1 ? "" : "s"} in ${file.name}`, 4000);
          }
          return out.file;
        } catch (err) {
          update("warn", `Could not redact ${file.name} — attached unredacted: ${err?.message ?? err}`, 0);
          return file;
        }
      }),
    );
  }

  function toDataTransfer(files) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    return dt;
  }

  // Should this event be held? Only when enabled, not our own, and carrying
  // at least one file we can redact.
  function shouldHold(event, files) {
    if (ours.has(event) || !isEnabled() || files.length === 0) return false;
    if (!files.some((f) => classifyFile(f))) {
      for (const f of files) notify.warn(`${f.name} attached unredacted (unsupported type)`);
      return false;
    }
    return true;
  }

  function dispatch(target, event) {
    ours.add(event);
    target.dispatchEvent(event);
  }

  function onChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    const files = [...(input.files ?? [])];
    const hold = shouldHold(event, files);
    log("change", { ours: ours.has(event), trusted: event.isTrusted, files: files.map((f) => f.name), hold });
    if (!hold) return;
    event.stopImmediatePropagation();
    redactAll(files).then((redacted) => {
      log("re-dispatching change with", redacted.map((f) => `${f.name} (${f.size} bytes)`));
      input.files = toDataTransfer(redacted).files;
      dispatch(input, new Event("input", { bubbles: true }));
      dispatch(input, new Event("change", { bubbles: true }));
    });
  }

  function onDrop(event) {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!shouldHold(event, files)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { target, clientX, clientY, screenX, screenY } = event;
    redactAll(files).then((redacted) => {
      const init = { bubbles: true, cancelable: true, composed: true, clientX, clientY, screenX, screenY };
      dispatch(target, new DragEvent("drop", { ...init, dataTransfer: toDataTransfer(redacted) }));
    });
  }

  function onPaste(event) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!shouldHold(event, files)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = event.target;
    redactAll(files).then((redacted) => {
      const init = { bubbles: true, cancelable: true, composed: true };
      dispatch(target, new ClipboardEvent("paste", { ...init, clipboardData: toDataTransfer(redacted) }));
    });
  }

  window.addEventListener("change", onChange, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("paste", onPaste, true);

  return {
    stop() {
      window.removeEventListener("change", onChange, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("paste", onPaste, true);
    },
  };
}
