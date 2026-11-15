// chatgpt.com. Two request formats:
//
// 1. Logged-out web (live as of 2026-11-14, captured in DevTools):
//      POST /unauth-mweb/conversation/updates
//      form body (URLSearchParams); the prompt is the `prompt` field.
//
// 2. Logged-in JSON (from memory, not yet verified live):
//      POST /backend-api/conversation  or  /backend-api/f/conversation
//      { messages: [{ content: { parts: [string | object] } }] }

const JSON_PATH = /^\/backend-api\/(f\/)?conversation$/;
const FORM_PATH = /^\/unauth-mweb\/conversation\/updates$/;

function jsonSlots(json) {
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

const isJson = (body) => body.trimStart().startsWith("{");

export default {
  id: "chatgpt",
  matches: (url, method) => method === "POST" && (JSON_PATH.test(url.pathname) || FORM_PATH.test(url.pathname)),
  extract(body) {
    if (isJson(body)) return jsonSlots(JSON.parse(body)).map(([get]) => get());
    const prompt = new URLSearchParams(body).get("prompt");
    return prompt === null ? [] : [prompt];
  },
  inject(body, texts) {
    if (isJson(body)) {
      const json = JSON.parse(body);
      jsonSlots(json).forEach(([, set], i) => set(texts[i]));
      return JSON.stringify(json);
    }
    const params = new URLSearchParams(body);
    params.set("prompt", texts[0]);
    return params.toString();
  },
};
