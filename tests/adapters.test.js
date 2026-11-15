// Fixtures are synthetic, built from the expected payload shapes in the plan.
// Replace them with real captures (scrubbed) once verified in DevTools.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import claude from "../src/main/adapters/claude.js";
import chatgpt from "../src/main/adapters/chatgpt.js";
import gemini from "../src/main/adapters/gemini.js";
import { ADAPTERS } from "../src/main/adapters/index.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").trim();
const u = (s) => new URL(s);

test("registry has all three adapters", () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id).sort(), ["chatgpt", "claude", "gemini"]);
});

describe("claude", () => {
  const base = "https://claude.ai/api/organizations/org-1/chat_conversations/conv-1";

  test("matches prompt endpoints", () => {
    for (const p of ["completion", "retry_completion", "title"]) {
      assert.equal(claude.matches(u(`${base}/${p}`), "POST"), true, p);
    }
  });

  test("ignores unrelated endpoints", () => {
    assert.equal(claude.matches(u("https://claude.ai/api/organizations/org-1/chat_conversations"), "GET"), false);
    assert.equal(claude.matches(u(`${base}/completion`), "GET"), false);
  });

  test("extracts prompt and pasted attachment text", () => {
    assert.deepEqual(claude.extract(fixture("claude-completion.json")), [
      "email me at jane@corp.io",
      "key AKIAIOSFODNN7EXAMPLE",
    ]);
  });

  test("extracts title message_content", () => {
    assert.deepEqual(claude.extract(fixture("claude-title.json")), ["email me at jane@corp.io"]);
  });

  test("inject round-trips", () => {
    const body = fixture("claude-completion.json");
    const out = claude.inject(body, ["X", "Y"]);
    assert.deepEqual(claude.extract(out), ["X", "Y"]);
    assert.equal(JSON.parse(out).timezone, "America/New_York");
  });
});

describe("chatgpt", () => {
  test("matches conversation endpoints", () => {
    assert.equal(chatgpt.matches(u("https://chatgpt.com/backend-api/conversation"), "POST"), true);
    assert.equal(chatgpt.matches(u("https://chatgpt.com/backend-api/f/conversation"), "POST"), true);
  });

  test("ignores unrelated endpoints", () => {
    assert.equal(chatgpt.matches(u("https://chatgpt.com/backend-api/conversations?offset=0"), "GET"), false);
    assert.equal(chatgpt.matches(u("https://chatgpt.com/backend-api/conversation/abc"), "GET"), false);
  });

  test("extracts string parts", () => {
    assert.deepEqual(chatgpt.extract(fixture("chatgpt-conversation.json")), ["email me at jane@corp.io"]);
  });

  test("skips non-string parts", () => {
    assert.deepEqual(chatgpt.extract(fixture("chatgpt-multimodal.json")), ["what is in this image, jane@corp.io?"]);
  });

  test("inject round-trips and keeps non-string parts", () => {
    const out = chatgpt.inject(fixture("chatgpt-multimodal.json"), ["X"]);
    assert.deepEqual(chatgpt.extract(out), ["X"]);
    assert.equal(JSON.parse(out).messages[0].content.parts[0].content_type, "image_asset_pointer");
  });
});

describe("gemini", () => {
  const url = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x&_reqid=1&rt=c";

  test("matches StreamGenerate", () => {
    assert.equal(gemini.matches(u(url), "POST"), true);
  });

  test("ignores unrelated endpoints", () => {
    assert.equal(gemini.matches(u("https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=x"), "POST"), false);
  });

  test("extracts prompt from nested f.req", () => {
    assert.deepEqual(gemini.extract(fixture("gemini-streamgenerate.txt")), ["email me at jane@corp.io"]);
  });

  test("inject keeps a valid form body with nested JSON", () => {
    const out = gemini.inject(fixture("gemini-streamgenerate.txt"), ["X \"quoted\" & more"]);
    const params = new URLSearchParams(out);
    assert.equal(params.get("at"), "AJvLN6Mx:1700000000000");
    const inner = JSON.parse(JSON.parse(params.get("f.req"))[1]);
    assert.equal(inner[0][0], 'X "quoted" & more');
    assert.deepEqual(inner[1], ["en"]);
    assert.deepEqual(gemini.extract(out), ['X "quoted" & more']);
  });
});
