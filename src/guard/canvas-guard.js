// MAIN world (Google Docs/Sheets/Slides): those apps paint document text onto
// <canvas>, which the DOM guard can't see. Wrap fillText/strokeText so, while
// the guard is active, sensitive values are painted as their stand-ins
// (squeezed to the original's width so layout doesn't shift), or masked until
// a stand-in is known.
//
// Runs in page context, so it only gets pattern detectors and stand-ins for
// values it reports (never the user's vault or dictionary).
import { guardText } from "./guard-text.js";

export function installCanvasGuard({ proto, detectors, isActive, lookup, request }) {
  const requested = new Set();

  function guarded(ctx, text) {
    if (!isActive() || typeof text !== "string") return null;
    const out = guardText(text, detectors, lookup);
    if (!out.changed) return null;
    const fresh = out.pending.filter((p) => !requested.has(p.original));
    if (fresh.length) {
      for (const p of fresh) requested.add(p.original);
      request(fresh);
    }
    return { text: out.text, width: ctx.measureText(text).width };
  }

  for (const name of ["fillText", "strokeText"]) {
    const original = proto[name];
    proto[name] = function (text, x, y, maxWidth) {
      const g = guarded(this, text);
      if (!g) return original.apply(this, arguments);
      const width = maxWidth === undefined ? g.width : Math.min(maxWidth, g.width);
      return original.call(this, g.text, x, y, width);
    };
  }

  return {
    // Allow values to be requested again (e.g. after the guard restarts).
    forgetRequests() {
      requested.clear();
    },
  };
}
