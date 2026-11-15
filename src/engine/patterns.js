// Tier 1 pattern detectors. Pure: no DOM, no chrome.*.
//
// Detector = { id, category, style: "token"|"fake", find(text) → Span[] }
// Span     = { start, end }

export function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function isIPv6(s) {
  if ((s.match(/:/g) ?? []).length < 2) return false;
  // Reject "::", "1::2", "::-1"-style slices and type signatures: need at
  // least two hex groups and three hex digits in total.
  const groups = s.split(":").filter(Boolean);
  if (groups.length < 2 || groups.join("").length < 3) return false;
  try {
    new URL(`http://[${s}]/`);
    return true;
  } catch {
    return false;
  }
}

// Build a detector from a regex. `group` reports a capture group's span
// instead of the whole match; `validate` filters candidate matches.
function regexDetector(id, style, source, { flags = "", group = 0, validate } = {}) {
  const re = new RegExp(source, `g${group ? "d" : ""}${flags}`);
  return {
    id,
    category: id.toUpperCase(),
    style,
    find(text) {
      const spans = [];
      for (const m of text.matchAll(re)) {
        const [start, end] = group ? m.indices[group] : [m.index, m.index + m[0].length];
        if (validate && !validate(text.slice(start, end))) continue;
        spans.push({ start, end });
      }
      return spans;
    },
  };
}

// Known card prefixes (Visa, Mastercard, Amex, Discover, JCB); separated
// numbers must use 4-4-4-4(-3) or Amex 4-6-5 grouping.
const CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[47]|35|6)/;
function isCard(s) {
  const digits = s.replace(/[ -]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  if (!CARD_PREFIX.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  if (digits !== s) {
    const groups = s.split(/[ -]/).map((g) => g.length).join(",");
    if (!/^4,4,4,4(,[1-4])?$|^4,6,5$/.test(groups)) return false;
  }
  return luhnValid(digits);
}

// Values that follow "token:"/"password =" in code rather than being secrets.
const NOT_SECRET = new Set([
  "string", "number", "boolean", "str", "int", "bool", "bytes", "any", "none",
  "null", "nil", "true", "false", "undefined", "await", "new", "function", "async",
  "optional", "self", "this", "required", "lambda",
]);
const IDENT_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

function secretDetector() {
  const re = new RegExp(
    String.raw`\b[A-Za-z_]*(?:password|passwd|pwd|secret|token|api_?key)["']?\s*[:=]\s*` +
      String.raw`(?:"([^"\s]+)"|'([^'\s]+)'|([^\s"'&,;()\[\]{}<>]+))`,
    "gdi",
  );
  return {
    id: "secret",
    category: "SECRET",
    style: "token",
    find(text) {
      const spans = [];
      for (const m of text.matchAll(re)) {
        const g = m[1] !== undefined ? 1 : m[2] !== undefined ? 2 : 3;
        const [start, end] = m.indices[g];
        if (g === 3) {
          // Unquoted: skip code (identifiers, dotted paths, calls, type names).
          const v = m[3];
          if (NOT_SECRET.has(v.toLowerCase()) || text[end] === "(") continue;
          if (IDENT_PATH.test(v) && !/\d/.test(v)) continue;
          if (/^(os|process|self|this|env|config|settings)\./i.test(v)) continue;
        }
        spans.push({ start, end });
      }
      return spans;
    },
  };
}

// --- Social media handles ---------------------------------------------------
// Profile links: only the username part is sensitive.
const PROFILE_PREFIXES = [
  String.raw`(?:x|twitter|instagram|github|facebook)\.com/`,
  String.raw`linkedin\.com/in/`,
  String.raw`(?:tiktok|youtube)\.com/@`,
  String.raw`threads\.net/@`,
  String.raw`reddit\.com/(?:u|user)/`,
  String.raw`bsky\.app/profile/`,
];
const USERNAME = String.raw`[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?`;
const NOT_PROFILES = new Set([
  "home", "explore", "search", "settings", "i", "intent", "share", "login", "signup", "about", "features",
  "pricing", "topics", "marketplace", "notifications", "messages", "hashtag", "p", "reel", "reels", "stories",
  "watch", "results", "channel", "help", "privacy", "terms", "tos", "orgs", "sponsors", "pulls", "issues", "new",
  "compose", "jobs", "groups", "events", "pages", "shorts", "feed", "r", "explore", "trending", "login", "enterprise",
]);
// Bare "@handle": only after whitespace / start / ( " ' [, not followed by
// "/", "(", "=", ":" or more word characters, and not a common code word.
const CODE_AT_WORDS = new Set([
  "media", "import", "charset", "keyframes", "supports", "layer", "container", "page", "namespace", "property",
  "font", "tailwind", "apply", "extend", "mixin", "include", "use", "forward", "if", "else", "each", "function",
  "return", "param", "returns", "throws", "type", "typedef", "deprecated", "override", "see", "since", "author",
  "example", "todo", "link", "inheritdoc", "interface", "implementation", "end", "synthesize", "selector",
  "protocol", "class", "dataclass", "staticmethod", "classmethod", "abstractmethod", "property", "app", "pytest",
  "mock", "patch", "test", "before", "after", "beforeeach", "aftereach", "component", "injectable", "input",
  "output", "ngmodule", "directive", "pipe", "types", "babel", "angular", "vue", "react", "svelte", "click",
  "submit", "change", "keydown", "keyup", "event", "value", "model", "slot", "ts-ignore", "ts-expect-error",
  "ts-nocheck", "license", "file", "module", "namespace", "const", "enum", "private", "public", "protected",
  "static", "async", "await", "everyone", "here", "channel", "latest", "next", "beta", "main",
]);

function handleDetector() {
  const link = new RegExp(String.raw`(?<![\w.-])(?:https?://)?(?:www\.|m\.|mobile\.)?(?:${PROFILE_PREFIXES.join("|")})(${USERNAME})`, "gdi");
  const bare = new RegExp(String.raw`(?<![^\s("'\[])@(${String.raw`[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?`})(?![\w@/(=:-])`, "gd");
  return {
    id: "handle",
    category: "HANDLE",
    style: "token",
    find(text) {
      const spans = [];
      for (const m of text.matchAll(link)) {
        if (NOT_PROFILES.has(m[1].toLowerCase())) continue;
        const [start, end] = m.indices[1];
        spans.push({ start, end });
      }
      for (const m of text.matchAll(bare)) {
        if (CODE_AT_WORDS.has(m[1].toLowerCase())) continue;
        spans.push({ start: m.index, end: m.index + m[0].length });
      }
      return spans.sort((a, b) => a.start - b.start);
    },
  };
}

const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;

const URL_TOKEN_PARAMS = [
  "token", "access_token", "refresh_token", "id_token", "auth", "key", "api_key",
  "apikey", "sig", "signature", "secret", "code", "session", "sessionid", "password",
];

export const PATTERN_DETECTORS = [
  regexDetector(
    "email",
    "fake",
    String.raw`(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])`,
  ),
  regexDetector(
    "phone",
    "fake",
    // Separators limited to space/dot/dash and consistent within the number;
    // bare space-separated 3-3-4 only with a +country prefix, so TSV/number
    // lists aren't mistaken for phones.
    String.raw`(?<![\w+.-])(?<!\d[ .,\t])(?:` +
      String.raw`(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\) ?\d{3}[-.]\d{4}|\d{3}([-.])\d{3}\1\d{4})` +
      String.raw`|\+\d{1,3} \d{3} \d{3} \d{4}` +
      String.raw`)(?![\w-])`,
  ),
  regexDetector(
    "ssn",
    "token",
    String.raw`(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])`,
  ),
  regexDetector("card", "token", String.raw`(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])`, {
    validate: isCard,
  }),
  {
    id: "ip",
    category: "IP",
    style: "token",
    find(text) {
      const v4 = regexDetector("ip", "token", String.raw`(?<![\d.])(?:${OCTET}\.){3}${OCTET}(?!\d|\.\d)`);
      const v6 = regexDetector("ip", "token", String.raw`(?<![\w:])[0-9A-Fa-f:]*:[0-9A-Fa-f:]*(?![\w:])`, {
        validate: isIPv6,
      });
      return [...v4.find(text), ...v6.find(text)];
    },
  },
  regexDetector(
    "api_key",
    "token",
    String.raw`(?<![\w-])(?:` +
      [
        String.raw`AKIA[0-9A-Z]{16}`,
        String.raw`sk-ant-[A-Za-z0-9_-]{20,}`,
        String.raw`sk-(?:proj-)?[A-Za-z0-9_-]{20,}`,
        String.raw`gh[pousr]_[A-Za-z0-9]{36,}`,
        String.raw`github_pat_[A-Za-z0-9_]{22,}`,
        String.raw`eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}`,
      ].join("|") +
      String.raw`)(?![\w-])`,
  ),
  regexDetector(
    "private_key",
    "token",
    String.raw`-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----`,
  ),
  secretDetector(),
  handleDetector(),
  regexDetector(
    "url_token",
    "token",
    // Lookbehind (not a consumed prefix) so every token param in one URL matches.
    String.raw`(?<=https?://[^\s?#]+\?[^\s#]*?(?<=[?&])(?:${URL_TOKEN_PARAMS.join("|")})=)[^&#\s]+`,
    { flags: "i" },
  ),
];
