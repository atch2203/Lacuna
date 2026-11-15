// gemini.google.com. Expected shapes from the plan; verify in DevTools.
//   POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
//        form body: f.req = JSON [null, "<inner JSON string>"]; prompt at inner[0][0]

const PATH_SUFFIX = "/assistant.lamda.BardFrontendService/StreamGenerate";

function parse(body) {
  const params = new URLSearchParams(body);
  const outer = JSON.parse(params.get("f.req"));
  const inner = JSON.parse(outer[1]);
  return { params, outer, inner };
}

export default {
  id: "gemini",
  matches: (url, method) => method === "POST" && url.pathname.endsWith(PATH_SUFFIX),
  extract(body) {
    const { inner } = parse(body);
    const prompt = inner?.[0]?.[0];
    return typeof prompt === "string" ? [prompt] : [];
  },
  inject(body, [prompt]) {
    const { params, outer, inner } = parse(body);
    inner[0][0] = prompt;
    outer[1] = JSON.stringify(inner);
    params.set("f.req", JSON.stringify(outer));
    return params.toString();
  },
};
