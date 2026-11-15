// Fixtures are synthetic, built from the expected payload shapes in the plan.
// Replace them with real captures (scrubbed) once verified in DevTools.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import claude from "../src/main/adapters/claude.js";
import chatgpt from "../src/main/adapters/chatgpt.js";
import gemini from "../src/main/adapters/gemini.js";
import claudeRpc from "../src/main/adapters/claude-rpc.js";
import { getString } from "../src/main/adapters/protobuf.js";
import { ADAPTERS } from "../src/main/adapters/index.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").trim();
const u = (s) => new URL(s);

test("registry has all adapters", () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id).sort(), ["chatgpt", "claude", "claude-rpc", "gemini"]);
});

// Shape mirrors the live request captured 2026-11-14 (ids replaced):
// POST /claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction
// Content-Type: application/proto, body = protobuf, prompt at field path 2 → 3.
describe("claude-rpc", () => {
  const url = "https://claude.ai/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction";
  const bin = () => new Uint8Array(readFileSync(new URL("./fixtures/claude-performaction.bin", import.meta.url)));

  test("is a bytes adapter", () => {
    assert.equal(claudeRpc.bodyType, "bytes");
  });

  test("matches PerformAction POST only", () => {
    assert.equal(claudeRpc.matches(u(url), "POST"), true);
    assert.equal(claudeRpc.matches(u(url), "GET"), false);
    assert.equal(claudeRpc.matches(u("https://claude.ai/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/ReportViewing"), "POST"), false);
  });

  test("extracts the prompt", () => {
    assert.deepEqual(claudeRpc.extract(bin()), ["zebracanary again: AKIAIOSFODNN7EXAMPLE"]);
  });

  test("actions without a prompt yield nothing", () => {
    assert.deepEqual(claudeRpc.extract(Uint8Array.from([0x0a, 0x02, 0x10, 0x03])), []);
    assert.deepEqual(claudeRpc.extract(new Uint8Array(0)), []);
  });

  test("inject round-trips and returns bytes", () => {
    const out = claudeRpc.inject(bin(), ["[API_KEY_1]"]);
    assert.ok(out instanceof Uint8Array);
    assert.deepEqual(claudeRpc.extract(out), ["[API_KEY_1]"]);
    assert.equal(getString(out, [2, 12]), "America/New_York");
    assert.equal(getString(out, [1, 1, 1]), "sess_0000000000000000");
  });
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

  test("matches logged-out conversation/updates", () => {
    assert.equal(chatgpt.matches(u("https://chatgpt.com/unauth-mweb/conversation/updates"), "POST"), true);
    assert.equal(chatgpt.matches(u("https://chatgpt.com/unauth-mweb/conversation/prepare"), "POST"), false);
  });

  // Shape mirrors the live logged-out request captured 2026-11-14 (tokens replaced).
  test("extracts the prompt form field", () => {
    assert.deepEqual(chatgpt.extract(fixture("chatgpt-unauth-updates.txt")), ["zebracanary again AKIAIOSFODNN7EXAMPLE"]);
  });

  test("form inject only changes the prompt field", () => {
    const body = fixture("chatgpt-unauth-updates.txt");
    const out = chatgpt.inject(body, ["X"]);
    const before = new URLSearchParams(body);
    const after = new URLSearchParams(out);
    assert.equal(after.get("prompt"), "X");
    before.delete("prompt");
    after.delete("prompt");
    assert.equal(after.toString(), before.toString());
  });

  test("inject round-trips and keeps non-string parts", () => {
    const out = chatgpt.inject(fixture("chatgpt-multimodal.json"), ["X"]);
    assert.deepEqual(chatgpt.extract(out), ["X"]);
    assert.equal(JSON.parse(out).messages[0].content.parts[0].content_type, "image_asset_pointer");
  });
});

describe("gemini (StreamGenerate, legacy)", () => {
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
    const out = gemini.inject(fixture("gemini-streamgenerate.txt"), ['X "quoted" & more']);
    const params = new URLSearchParams(out);
    assert.equal(params.get("at"), "AJvLN6Mx:1700000000000");
    const inner = JSON.parse(JSON.parse(params.get("f.req"))[1]);
    assert.equal(inner[0][0], 'X "quoted" & more');
    assert.deepEqual(inner[1], ["en"]);
    assert.deepEqual(gemini.extract(out), ['X "quoted" & more']);
  });
});

// Captured live 2026-11-14: prompts go over a WebChannel to
// geminiweb-pa.clients6.google.com/v1/processSession as form fields
// count/ofs/reqN___data__, where each reqN___data__ is base64 protobuf and the
// prompt sits at field path 2 → 9 → 1.
describe("gemini (processSession WebChannel)", () => {
  const url = "https://geminiweb-pa.clients6.google.com/v1/processSession?VER=8&gsessionid=x&SID=y&RID=1&AID=0&zx=z&t=1";
  const PROMPT = "zebracanary AKIAIOSFODNN7EXAMPLE";
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const form = (pairs) => new URLSearchParams(pairs).toString();
  const decodeReq = (body, key = "req0___data__") => [...Buffer.from(new URLSearchParams(body).get(key), "base64")];

  test("matches processSession POST", () => {
    assert.equal(gemini.matches(u(url), "POST"), true);
  });

  test("ignores processSession GET (response stream) and other hosts", () => {
    assert.equal(gemini.matches(u(url), "GET"), false);
    assert.equal(gemini.matches(u("https://example.com/v1/processSession"), "POST"), false);
  });

  test("extracts the prompt from the captured request", () => {
    assert.deepEqual(gemini.extract(fixture("gemini-processsession.txt")), [PROMPT]);
  });

  test("non-prompt channel messages yield nothing", () => {
    assert.deepEqual(gemini.extract("count=0"), []);
    assert.deepEqual(gemini.extract(form([["count", "1"], ["ofs", "2"], ["req0___data__", "IgIIAQ=="]])), []);
  });

  test("inject preserves sibling fields and form params", () => {
    const out = gemini.inject(fixture("gemini-processsession.txt"), ["[API_KEY_1]"]);
    const params = new URLSearchParams(out);
    assert.equal(params.get("count"), "1");
    assert.equal(params.get("ofs"), "1");
    const s = "[API_KEY_1]";
    // 12 len | 08 01 | 4a len | 0a len | s
    assert.deepEqual(decodeReq(out), [0x12, s.length + 6, 0x08, 0x01, 0x4a, s.length + 2, 0x0a, s.length, ...Buffer.from(s)]);
    assert.deepEqual(gemini.extract(out), [s]);
  });

  test("inject rewrites multi-byte lengths for long prompts", () => {
    const long = "x".repeat(300) + " é";
    const out = gemini.inject(fixture("gemini-processsession.txt"), [long]);
    assert.deepEqual(gemini.extract(out), [long]);
  });

  test("finds the prompt in a later reqN when count > 1", () => {
    const promptMsg = decodeReq(fixture("gemini-processsession.txt"));
    const body = form([["count", "2"], ["ofs", "5"], ["req0___data__", "IgIIAQ=="], ["req1___data__", b64(promptMsg)]]);
    assert.deepEqual(gemini.extract(body), [PROMPT]);
    const out = gemini.inject(body, ["Y"]);
    assert.equal(new URLSearchParams(out).get("req0___data__"), "IgIIAQ==");
    assert.deepEqual(gemini.extract(out), ["Y"]);
  });
});
