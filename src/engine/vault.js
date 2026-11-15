// Global original ⇄ stand-in mapping. Pure: persistence is the caller's job.
import { fakeFor, tokenFor } from "./fakes.js";

export class Vault {
  constructor(state) {
    this.byOriginal = { ...(state?.byOriginal ?? {}) };
    this.byStandIn = { ...(state?.byStandIn ?? {}) };
    this.counters = { ...(state?.counters ?? {}) };
  }

  standInFor(original, category, style, avoid = "") {
    const existing = this.byOriginal[original];
    if (existing !== undefined) return existing;

    let standIn;
    do {
      const n = (this.counters[category] ?? 0) + 1;
      this.counters[category] = n;
      standIn = style === "fake" ? fakeFor(category, n) : tokenFor(category, n);
    } while (
      this.byStandIn[standIn] !== undefined ||
      (style === "fake" && avoid.includes(standIn))
    );

    this.byOriginal[original] = standIn;
    this.byStandIn[standIn] = original;
    return standIn;
  }

  entries() {
    return Object.entries(this.byStandIn);
  }

  toJSON() {
    return {
      byOriginal: { ...this.byOriginal },
      byStandIn: { ...this.byStandIn },
      counters: { ...this.counters },
    };
  }
}
