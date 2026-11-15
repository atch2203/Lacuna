// Global original ⇄ stand-in mapping. Pure: persistence is the caller's job.
import { fakeLike, tokenFor } from "./fakes.js";
import { classifyValue } from "./manual.js";

export class Vault {
  // options.rng: random source for fakes (tests pass a seeded one).
  constructor(state, { rng = Math.random } = {}) {
    this.rng = rng;
    this.byOriginal = { ...(state?.byOriginal ?? {}) };
    this.byStandIn = { ...(state?.byStandIn ?? {}) };
    this.counters = { ...(state?.counters ?? {}) };
    // Originals the user switched off: not redacted, not restored. Their fake
    // is kept so re-enabling brings the same fake back.
    this.disabled = { ...(state?.disabled ?? {}) };
    // Values added by hand: original → category (detected exactly; see manual.js).
    this.manual = { ...(state?.manual ?? {}) };
  }

  // Add a value by hand; returns its fake (an existing fake is kept).
  addManual(value, category) {
    const v = String(value ?? "").trim();
    if (!v) return undefined;
    const cat = category ?? this.manual[v] ?? classifyValue(v);
    this.manual[v] = cat;
    return this.standInFor(v, cat);
  }

  // Replace an item's placeholder. The old placeholder stays as an alias so
  // chats that already used it still restore. → { ok: true } | { error }
  setStandIn(original, standIn) {
    const next = String(standIn ?? "").trim();
    if (this.byOriginal[original] === undefined) return { error: "not in the vault" };
    if (!next) return { error: "placeholder can't be empty" };
    if (next === original) return { error: "placeholder is the same as the real value" };
    if (next === this.byOriginal[original]) return { ok: true };
    const owner = this.byStandIn[next];
    if ((owner !== undefined && owner !== original) || this.byOriginal[next] !== undefined) {
      return { error: "already used by another vault item" };
    }
    this.byOriginal[original] = next;
    this.byStandIn[next] = original;
    return { ok: true };
  }

  // One [currentStandIn, original] per item (no old aliases).
  currentEntries() {
    return Object.entries(this.byOriginal).map(([original, standIn]) => [standIn, original]);
  }

  isManual(original) {
    return this.manual[original] !== undefined;
  }

  isDisabled(original) {
    return this.disabled[original] === true;
  }

  setEnabled(original, enabled) {
    if (enabled) delete this.disabled[original];
    else if (this.byOriginal[original] !== undefined) this.disabled[original] = true;
  }

  remove(original) {
    for (const [standIn, o] of Object.entries(this.byStandIn)) if (o === original) delete this.byStandIn[standIn];
    delete this.byOriginal[original];
    delete this.disabled[original];
    delete this.manual[original];
  }

  // Every stand-in is a realistic fake with the same length and shape as the
  // original (see fakeLike). `style` is accepted for compatibility and ignored.
  // avoid: text the fake must not appear in, or a predicate (s) => boolean.
  standInFor(original, category, _style, avoid = "") {
    const isAvoided = typeof avoid === "function" ? avoid : (s) => avoid.includes(s);
    const existing = this.byOriginal[original];
    if (existing !== undefined) return existing;

    this.counters[category] = (this.counters[category] ?? 0) + 1;
    let standIn;
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = fakeLike(category, original, this.rng);
      if (candidate !== original && this.byStandIn[candidate] === undefined && !isAvoided(candidate)) {
        standIn = candidate;
        break;
      }
    }
    // Practically unreachable (random collisions); fall back to a labelled token.
    standIn ??= tokenFor(category, this.counters[category]);

    this.byOriginal[original] = standIn;
    this.byStandIn[standIn] = original;
    return standIn;
  }

  // Record a stand-in chosen elsewhere (e.g. a name part derived from the
  // full name's fake). Existing mappings win.
  link(original, standIn) {
    if (this.byOriginal[original] !== undefined || this.byStandIn[standIn] !== undefined) return;
    this.byOriginal[original] = standIn;
    this.byStandIn[standIn] = original;
  }

  // True when text is one of this vault's stand-ins (so it isn't re-redacted).
  isStandIn(text) {
    return this.byStandIn[text] !== undefined;
  }

  // [standIn, original] pairs of enabled items (what gets restored).
  entries() {
    return activeEntries(this);
  }

  // Empty mappings, same counters: stand-ins already sent out (and still in
  // old chats) are never reissued for a different original.
  cleared() {
    return new Vault({ counters: this.counters }, { rng: this.rng });
  }

  toJSON() {
    return {
      byOriginal: { ...this.byOriginal },
      byStandIn: { ...this.byStandIn },
      counters: { ...this.counters },
      disabled: { ...this.disabled },
      manual: { ...this.manual },
    };
  }
}

// Enabled [standIn, original] pairs of a vault or its JSON state.
export function activeEntries(state) {
  const disabled = state?.disabled ?? {};
  return Object.entries(state?.byStandIn ?? {}).filter(([, original]) => disabled[original] !== true);
}
