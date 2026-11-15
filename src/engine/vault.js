// Global original ⇄ stand-in mapping. Pure: persistence is the caller's job.
import { fakeLike, tokenFor } from "./fakes.js";

export class Vault {
  // options.rng: random source for fakes (tests pass a seeded one).
  constructor(state, { rng = Math.random } = {}) {
    this.rng = rng;
    this.byOriginal = { ...(state?.byOriginal ?? {}) };
    this.byStandIn = { ...(state?.byStandIn ?? {}) };
    this.counters = { ...(state?.counters ?? {}) };
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

  // True when text is one of this vault's stand-ins (so it isn't re-redacted).
  isStandIn(text) {
    return this.byStandIn[text] !== undefined;
  }

  entries() {
    return Object.entries(this.byStandIn);
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
    };
  }
}
