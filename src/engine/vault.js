// Global original ⇄ stand-in mapping. Pure: persistence is the caller's job.
import { fakeFor, tokenFor } from "./fakes.js";

export class Vault {
  constructor(state) {
    this.byOriginal = { ...(state?.byOriginal ?? {}) };
    this.byStandIn = { ...(state?.byStandIn ?? {}) };
    this.counters = { ...(state?.counters ?? {}) };
  }

  // avoid: text the fake must not appear in, or a predicate (s) => boolean.
  standInFor(original, category, style, avoid = "") {
    const isAvoided = typeof avoid === "function" ? avoid : (s) => avoid.includes(s);
    const existing = this.byOriginal[original];
    if (existing !== undefined) return existing;

    let standIn;
    do {
      const n = (this.counters[category] ?? 0) + 1;
      this.counters[category] = n;
      standIn = style === "fake" ? fakeFor(category, n) : tokenFor(category, n);
    } while (
      this.byStandIn[standIn] !== undefined ||
      (style === "fake" && isAvoided(standIn))
    );

    this.byOriginal[original] = standIn;
    this.byStandIn[standIn] = original;
    return standIn;
  }

  entries() {
    return Object.entries(this.byStandIn);
  }

  // Empty mappings, same counters: stand-ins already sent out (and still in
  // old chats) are never reissued for a different original.
  cleared() {
    return new Vault({ counters: this.counters });
  }

  toJSON() {
    return {
      byOriginal: { ...this.byOriginal },
      byStandIn: { ...this.byStandIn },
      counters: { ...this.counters },
    };
  }
}
