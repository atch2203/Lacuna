// Stand-in generators. Pure: no DOM, no chrome.*.

const FIRST_NAMES = [
  "Jordan", "Riley", "Casey", "Morgan", "Avery", "Quinn", "Taylor", "Skyler",
  "Rowan", "Emerson", "Parker", "Reese", "Hayden", "Dakota", "Kendall", "Sage",
  "Finley", "Harper", "Logan", "Peyton", "Cameron", "Drew", "Elliot", "Jamie",
  "Kai", "Lane", "Marlowe", "Noel", "Oakley", "Remy",
];

const LAST_NAMES = [
  "Lee", "Rivera", "Brooks", "Hayes", "Ellis", "Foster", "Grant", "Hollis",
  "Irving", "Jensen", "Keller", "Lowell", "Mercer", "Nash", "Orton", "Pryor",
  "Quill", "Ramsey", "Sutton", "Thorne", "Underhill", "Vance", "Whitlock",
  "Yardley", "Abbott", "Barlow", "Calloway", "Dempsey", "Easton", "Fairley",
];

const ORG_NAMES = [
  "Northwind", "Bluefin", "Cobalt", "Driftwood", "Evergreen", "Foxglove",
  "Granite", "Harborview", "Ironbark", "Juniper", "Kestrel", "Larkspur",
  "Meridian", "Nimbus", "Obsidian", "Pinecrest", "Quarry", "Redwood",
  "Silverline", "Tidewater", "Umber", "Vantage", "Willow", "Zephyr",
  "Alder", "Birchwood", "Cascade", "Dunmore", "Elmstead", "Falcon Ridge",
];

const ORG_SUFFIXES = ["Labs", "Systems", "Partners", "Group", "Works", "Holdings"];

export function tokenFor(category, n) {
  return `[${category}_${n}]`;
}

// Index n (1-based) into a pair of lists so consecutive n give distinct
// combinations until FIRST × LAST is exhausted, then append a number.
function pairFor(n, a, b) {
  const i = n - 1;
  const size = a.length * b.length;
  const round = Math.floor(i / size);
  const j = i % size;
  const x = a[j % a.length];
  const y = b[(j + Math.floor(j / a.length)) % b.length];
  return { x, y, round };
}

function personFor(n) {
  const { x, y, round } = pairFor(n, FIRST_NAMES, LAST_NAMES);
  return round === 0 ? `${x} ${y}` : `${x} ${y} ${round + 1}`;
}

export function fakeFor(category, n) {
  switch (category) {
    case "PERSON":
      return personFor(n);
    case "ORG": {
      const { x, y, round } = pairFor(n, ORG_NAMES, ORG_SUFFIXES);
      return round === 0 ? `${x} ${y}` : `${x} ${y} ${round + 1}`;
    }
    case "EMAIL": {
      const { x, y, round } = pairFor(n, FIRST_NAMES, LAST_NAMES);
      const suffix = round === 0 ? "" : String(round + 1);
      return `${x.toLowerCase()}.${y.toLowerCase()}${suffix}@example.com`;
    }
    case "PHONE": {
      // Reserved fictional range 555-0100..555-0199, then wrap with an area code.
      const i = n - 1;
      const line = `555-01${String(i % 100).padStart(2, "0")}`;
      const round = Math.floor(i / 100);
      return round === 0 ? line : `${200 + round}-${line}`;
    }
    default:
      throw new Error(`No fake generator for category ${category}`);
  }
}

// ---------------------------------------------------------------------------
// Format-preserving fakes: same length (and shape) as the original, so
// layouts don't shift and the fake reads like real data.

// Small deterministic PRNG for tests (mulberry32).
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIGITS = "0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const CONSONANTS = "bcdfghjklmnprstvwz";
const VOWELS = "aeiou";
const pick = (s, rng) => s[Math.floor(rng() * s.length)];
const intIn = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));

// Replace each letter/digit with a random one of the same class; keep the rest.
function scramble(str, rng, { hex = false } = {}) {
  let out = "";
  for (const ch of str) {
    if (hex && /[0-9a-fA-F]/.test(ch)) out += pick(ch === ch.toUpperCase() && /[A-F]/.test(ch) ? "0123456789ABCDEF" : "0123456789abcdef", rng);
    else if (/[0-9]/.test(ch)) out += pick(DIGITS, rng);
    else if (/[A-Z]/.test(ch)) out += pick(UPPER, rng);
    else if (/[a-z]/.test(ch)) out += pick(LOWER, rng);
    else out += ch;
  }
  return out;
}

function matchCase(word, template) {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const t = template[i] ?? "";
    out += t && t === t.toUpperCase() && t !== t.toLowerCase() ? word[i].toUpperCase() : word[i].toLowerCase();
  }
  return out;
}

function pronounceable(n, rng) {
  let out = "";
  let consonant = rng() < 0.6;
  while (out.length < n) {
    out += pick(consonant ? CONSONANTS : VOWELS, rng);
    consonant = !consonant;
  }
  return out;
}

const wordsCache = new Map();
function wordOfLength(n, lists, rng) {
  const key = `${lists.length}:${lists[0]?.[0] ?? ""}:${n}`;
  if (!wordsCache.has(key)) wordsCache.set(key, lists.flat().filter((w) => w.length === n && !w.includes(" ")));
  const options = wordsCache.get(key);
  return options.length ? options[Math.floor(rng() * options.length)] : pronounceable(n, rng);
}

// Replace each word (run of letters) with a same-length word, same case.
function fakeWords(str, rng, lists) {
  return str.replace(/[A-Za-z]+/g, (w) => matchCase(wordOfLength(w.length, lists, rng), w));
}

function luhnCheckDigit(digits) {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

function fakeCard(original, rng) {
  const digits = original.replace(/\D/g, "");
  const keep = digits.startsWith("3") ? 2 : 1; // Amex needs 34/37
  let body = digits.slice(0, keep);
  while (body.length < digits.length - 1) body += pick(DIGITS, rng);
  body += luhnCheckDigit(body);
  let i = 0;
  return original.replace(/\d/g, () => body[i++]);
}

function fakeOctet(len, rng) {
  if (len === 1) return String(intIn(1, 9, rng));
  if (len === 2) return String(intIn(10, 99, rng));
  return String(intIn(100, 255, rng));
}

function fakeIp(original, rng) {
  if (original.includes(":")) return scramble(original, rng, { hex: true });
  return original
    .split(".")
    .map((o) => fakeOctet(o.length, rng))
    .join(".");
}

function fakeSsn(rng) {
  let area;
  do area = intIn(1, 899, rng);
  while (area === 666);
  const pad = (n, w) => String(n).padStart(w, "0");
  return `${pad(area, 3)}-${pad(intIn(1, 99, rng), 2)}-${pad(intIn(1, 9999, rng), 4)}`;
}

// "first.last" email locals grouped by length, built once.
let localsByLength = null;
function emailLocals(length) {
  if (!localsByLength) {
    localsByLength = new Map();
    const add = (candidate) => {
      if (!localsByLength.has(candidate.length)) localsByLength.set(candidate.length, []);
      localsByLength.get(candidate.length).push(candidate);
    };
    for (const f of FIRST_NAMES) {
      add(f.toLowerCase());
      for (const l of LAST_NAMES) add(`${f}.${l}`.toLowerCase());
    }
    for (const l of LAST_NAMES) add(l.toLowerCase());
  }
  return localsByLength.get(length) ?? [];
}

function fakeEmail(original, rng) {
  const at = original.lastIndexOf("@");
  const local = original.slice(0, at);
  const domain = original.slice(at + 1);
  const names = emailLocals(local.length);
  const fakeLocal = names.length ? names[Math.floor(rng() * names.length)] : scramble(local, rng);
  const labels = domain.split(".");
  const tld = labels.pop();
  return `${fakeLocal}@${[...labels.map((l) => scramble(l, rng)), tld].join(".")}`;
}

const API_PREFIX = /^(AKIA|sk-ant-|sk-proj-|sk-|gh[pousr]_|github_pat_)/;

function fakeApiKey(original, rng) {
  if (original.startsWith("eyJ")) {
    return original
      .split(".")
      .map((seg, i) => (i < 2 && seg.startsWith("eyJ") ? "eyJ" + scramble(seg.slice(3), rng) : scramble(seg, rng)))
      .join(".");
  }
  const prefix = original.match(API_PREFIX)?.[0] ?? "";
  return prefix + scramble(original.slice(prefix.length), rng);
}

function fakePrivateKey(original, rng) {
  const lines = original.split("\n");
  return lines.map((line, i) => (i === 0 || i === lines.length - 1 ? line : scramble(line, rng))).join("\n");
}

const PHONE_COUNTRY = /^\+\d{1,3}/;

export function fakeLike(category, original, rng = Math.random) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const fake = fakeOnce(category, original, rng);
    if (fake !== original) return fake;
  }
  return fakeOnce(category, original, rng);
}

function fakeOnce(category, original, rng) {
  switch (category) {
    case "EMAIL":
      return fakeEmail(original, rng);
    case "PHONE": {
      const cc = original.match(PHONE_COUNTRY)?.[0] ?? "";
      return cc + scramble(original.slice(cc.length), rng);
    }
    case "SSN":
      return fakeSsn(rng);
    case "CARD":
      return fakeCard(original, rng);
    case "IP":
      return fakeIp(original, rng);
    case "API_KEY":
      return fakeApiKey(original, rng);
    case "PRIVATE_KEY":
      return fakePrivateKey(original, rng);
    case "PERSON":
      return fakeWords(original, rng, [FIRST_NAMES, LAST_NAMES]);
    case "ORG":
      return fakeWords(original, rng, [ORG_NAMES]);
    case "OTHER":
      return fakeWords(original, rng, []);
    default:
      return scramble(original, rng); // SECRET, URL_TOKEN, anything else
  }
}
