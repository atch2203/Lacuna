// Site adapters. Each: { id, bodyType?: "text"|"bytes", matches(url, method), extract(body), inject(body, texts) }.
import claude from "./claude.js";
import claudeRpc from "./claude-rpc.js";
import chatgpt from "./chatgpt.js";
import gemini from "./gemini.js";

export const ADAPTERS = [claude, claudeRpc, chatgpt, gemini];
