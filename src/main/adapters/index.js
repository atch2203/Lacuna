// Site adapters. Each: { id, matches(url, method), extract(body), inject(body, texts) }.
import claude from "./claude.js";
import chatgpt from "./chatgpt.js";
import gemini from "./gemini.js";

export const ADAPTERS = [claude, chatgpt, gemini];
