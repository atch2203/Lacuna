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
