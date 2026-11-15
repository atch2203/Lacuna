// chatgpt.com. Expected shapes from the plan; verify in DevTools.
//   POST /backend-api/conversation  or  /backend-api/f/conversation
//        { messages: [{ content: { parts: [string | object] } }] }

const PATH = /^\/backend-api\/(f\/)?conversation$/;

function slots(json) {
  const out = [];
  for (const m of json.messages ?? []) {
    const parts = m?.content?.parts;
    if (!Array.isArray(parts)) continue;
    parts.forEach((p, i) => {
      if (typeof p === "string") out.push([() => parts[i], (v) => (parts[i] = v)]);
    });
  }
  return out;
}

export default {
  id: "chatgpt",
  matches: (url, method) => method === "POST" && PATH.test(url.pathname),
  extract: (body) => slots(JSON.parse(body)).map(([get]) => get()),
  inject(body, texts) {
    const json = JSON.parse(body);
    slots(json).forEach(([, set], i) => set(texts[i]));
    return JSON.stringify(json);
  },
};
