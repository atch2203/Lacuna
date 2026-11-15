// claude.ai Connect-RPC API (live as of 2026-11-14, captured in DevTools):
//   POST /claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction
//   Content-Type: application/proto, body = raw protobuf (no Connect envelope).
//   The prompt is the string at field path 2 → 3. Other actions on the same
//   endpoint have no such field and are left untouched.
// Not yet mapped: where long pastes turned into attachments live.
import { getString, setString } from "./protobuf.js";

const PATH = "/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction";
const PROMPT_PATH = [2, 3];

export default {
  id: "claude-rpc",
  bodyType: "bytes",
  matches: (url, method) => method === "POST" && url.pathname === PATH,
  extract(bytes) {
    const prompt = getString(bytes, PROMPT_PATH);
    return prompt === undefined ? [] : [prompt];
  },
  inject: (bytes, [prompt]) => setString(bytes, PROMPT_PATH, prompt),
};
