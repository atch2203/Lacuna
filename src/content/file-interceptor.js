// Catches files the user attaches (file picker, drag-and-drop, paste) before
// the page's own listeners run, redacts them, then re-dispatches the event
// with the redacted files. Fails open: on error the original file is used.
import { classifyFile } from "../docs/router.js";

const log = (...args) => console.debug("[llm-redactor files]", ...args);

function toDataTransfer(files) {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt;
}

// Browser defaults; tests inject fakes.
const DEFAULTS = {
  isFileInput: (t) => t instanceof HTMLInputElement && t.type === "file",
  setFiles: (input, files) => (input.files = toDataTransfer(files).files),
  makeEvent: (kind, type, init, files) => {
    if (kind === "drop") return new DragEvent(type, { ...init, dataTransfer: toDataTransfer(files) });
    if (kind === "paste") return new ClipboardEvent(type, { ...init, clipboardData: toDataTransfer(files) });
    return new Event(type, init);
  },
};

// processFile: (File) => Promise<{ status, file, count, warnings? }>
// notify: { working(message) => update(kind, message, timeoutMs), warn(message) }
export function startFileInterceptor({
  processFile,
  isEnabled,
  notify,
  win = window,
  doc = document,
  isFileInput = DEFAULTS.isFileInput,
  setFiles = DEFAULTS.setFiles,
  makeEvent = DEFAULTS.makeEvent,
}) {
  const ours = new WeakSet();
  const heldInputs = new WeakSet();

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
          for (const w of out.warnings ?? []) notify.warn(`${file.name}: ${w}`);
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

  // Hold only when enabled, not our own event, and at least one file is redactable.
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

  // Chrome fires `input` then `change` on file inputs; hold whichever comes
  // first, swallow the other, and re-dispatch both once redaction is done.
  function onFileInputEvent(event) {
    const input = event.target;
    if (!isFileInput(input) || ours.has(event)) return;
    if (heldInputs.has(input)) {
      event.stopImmediatePropagation();
      return;
    }
    const files = [...(input.files ?? [])];
    const hold = shouldHold(event, files);
    log(event.type, { trusted: event.isTrusted, files: files.map((f) => f.name), hold });
    if (!hold) return;
    event.stopImmediatePropagation();
    heldInputs.add(input);
    setFiles(input, []); // nothing reads the originals while we work
    redactAll(files).then((redacted) => {
      log("re-dispatching input/change with", redacted.map((f) => `${f.name} (${f.size} bytes)`));
      setFiles(input, redacted);
      heldInputs.delete(input);
      dispatch(input, makeEvent("input", "input", { bubbles: true }));
      dispatch(input, makeEvent("change", "change", { bubbles: true }));
    });
  }

  // A drop overlay or paste box may be unmounted while we work; events on a
  // detached node never reach the page, so fall back to a live target.
  function liveTarget(target, fallback) {
    return target?.isConnected ? target : (fallback() ?? doc.body);
  }

  function onDrop(event) {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!shouldHold(event, files)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { target, clientX, clientY, screenX, screenY } = event;
    redactAll(files).then((redacted) => {
      const init = { bubbles: true, cancelable: true, composed: true, clientX, clientY, screenX, screenY };
      const to = liveTarget(target, () => doc.elementFromPoint(clientX, clientY));
      dispatch(to, makeEvent("drop", "drop", init, redacted));
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
      const to = liveTarget(target, () => doc.activeElement);
      dispatch(to, makeEvent("paste", "paste", init, redacted));
    });
  }

  win.addEventListener("input", onFileInputEvent, true);
  win.addEventListener("change", onFileInputEvent, true);
  win.addEventListener("drop", onDrop, true);
  win.addEventListener("paste", onPaste, true);

  return {
    stop() {
      win.removeEventListener("input", onFileInputEvent, true);
      win.removeEventListener("change", onFileInputEvent, true);
      win.removeEventListener("drop", onDrop, true);
      win.removeEventListener("paste", onPaste, true);
    },
  };
}
