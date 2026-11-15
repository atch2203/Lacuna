import { test } from "node:test";
import assert from "node:assert/strict";
import { installFilePickerHook } from "../src/main/file-picker-hook.js";

test("picker handles return a redacted file from getFile", async () => {
  const original = new File(["email jane@corp.io"], "secret.pdf", { type: "application/pdf" });
  const handle = {
    kind: "file",
    name: original.name,
    getFile: async () => original,
  };
  const win = {
    showOpenFilePicker: async () => [handle],
  };

  installFilePickerHook({
    win,
    redact: async (file) => new File(["redacted"], file.name, { type: file.type }),
  });

  const [picked] = await win.showOpenFilePicker();
  assert.equal(picked.name, "secret.pdf");
  assert.equal(await (await picked.getFile()).text(), "redacted");
  assert.equal(await (await handle.getFile()).text(), "email jane@corp.io");
});
