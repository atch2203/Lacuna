// gemini.google.com. Two request formats:
//
// 1. processSession WebChannel (live as of 2026-11-14, captured in DevTools):
//      POST https://geminiweb-pa.clients6.google.com/v1/processSession?...  (XHR)
//      form body: count=N&ofs=K&req0___data__=<b64>&req1___data__=<b64>...
//      each reqN___data__ is standard-base64 protobuf; the prompt is the
//      string at field path 2 → 9 → 1. Other channel messages have no such
//      path and are left untouched.
//
// 2. StreamGenerate (legacy, kept in case it's still served to some clients):
//      POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
//      form body: f.req = JSON [null, "<inner JSON string>"]; prompt at inner[0][0]
import { getString, setString } from "./protobuf.js";

const SESSION_HOST = "geminiweb-pa.clients6.google.com";
const SESSION_PATH = "/v1/processSession";
const PROMPT_PATH = [2, 9, 1];
const DATA_KEY = /^req\d+___data__$/;

const STREAM_SUFFIX = "/assistant.lamda.BardFrontendService/StreamGenerate";

function b64ToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function isSessionBody(params) {
  return [...params.keys()].some((k) => DATA_KEY.test(k));
}

// [key, bytes] for every channel message that carries a prompt, in order.
function promptMessages(params) {
  const out = [];
  for (const [key, value] of params) {
    if (!DATA_KEY.test(key)) continue;
    let bytes;
    try {
      bytes = b64ToBytes(value);
    } catch {
      continue;
    }
    if (getString(bytes, PROMPT_PATH) !== undefined) out.push([key, bytes]);
  }
  return out;
}

function parseStream(params) {
  const outer = JSON.parse(params.get("f.req"));
  const inner = JSON.parse(outer[1]);
  return { outer, inner };
}

export default {
  id: "gemini",
  matches(url, method) {
    if (method !== "POST") return false;
    if (url.hostname === SESSION_HOST && url.pathname === SESSION_PATH) return true;
    return url.pathname.endsWith(STREAM_SUFFIX);
  },
  extract(body) {
    const params = new URLSearchParams(body);
    if (params.has("f.req")) {
      const prompt = parseStream(params).inner?.[0]?.[0];
      return typeof prompt === "string" ? [prompt] : [];
    }
    if (!isSessionBody(params)) return [];
    return promptMessages(params).map(([, bytes]) => getString(bytes, PROMPT_PATH));
  },
  inject(body, texts) {
    const params = new URLSearchParams(body);
    if (params.has("f.req")) {
      const { outer, inner } = parseStream(params);
      inner[0][0] = texts[0];
      outer[1] = JSON.stringify(inner);
      params.set("f.req", JSON.stringify(outer));
      return params.toString();
    }
    promptMessages(params).forEach(([key, bytes], i) => {
      params.set(key, bytesToB64(setString(bytes, PROMPT_PATH, texts[i])));
    });
    return params.toString();
  },
};
