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
    String.raw`(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]\d{4}(?!\d)`,
  ),
  regexDetector(
    "ssn",
    "token",
    String.raw`(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])`,
  ),
  regexDetector("card", "token", String.raw`(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])`, {
    validate: (s) => luhnValid(s.replace(/[ -]/g, "")),
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
  regexDetector(
    "secret",
    "token",
    String.raw`\b[A-Za-z_]*(?:password|passwd|pwd|secret|token|api_?key)\s*[:=]\s*["']?([^\s"'&,;]+)`,
    { flags: "i", group: 1 },
  ),
  regexDetector(
    "url_token",
    "token",
    // Lookbehind (not a consumed prefix) so every token param in one URL matches.
    String.raw`(?<=https?://[^\s?#]+\?[^\s#]*?(?<=[?&])(?:${URL_TOKEN_PARAMS.join("|")})=)[^&#\s]+`,
    { flags: "i" },
  ),
];
