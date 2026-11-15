// claude.ai. Expected shapes from the plan; verify in DevTools.
//   POST /api/organizations/:org/chat_conversations/:conv/{completion,retry_completion}
//        { prompt, attachments: [{ extracted_content }] }   (long pastes become attachments)
//   POST /api/organizations/:org/chat_conversations/:conv/title
//        { message_content }

const PATH = /^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(completion|retry_completion|title)$/;

// Ordered list of [getter, setter] slots for every prompt-bearing string.
function slots(json) {
  const out = [];
  for (const key of ["prompt", "message_content"]) {
    if (typeof json[key] === "string") out.push([() => json[key], (v) => (json[key] = v)]);
  }
  for (const a of json.attachments ?? []) {
    if (typeof a?.extracted_content === "string") {
      out.push([() => a.extracted_content, (v) => (a.extracted_content = v)]);
    }
  }
  return out;
}

export default {
  id: "claude",
  matches: (url, method) => method === "POST" && PATH.test(url.pathname),
  extract: (body) => slots(JSON.parse(body)).map(([get]) => get()),
  inject(body, texts) {
    const json = JSON.parse(body);
    slots(json).forEach(([, set], i) => set(texts[i]));
    return JSON.stringify(json);
  },
};
