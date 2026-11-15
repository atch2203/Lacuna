// Stand-ins for values first seen during a screen share. Kept in a separate,
// session-only, capped map (not the persistent vault): any page can show any
// text and fake a share, so page content must not be able to grow the
// persistent vault (which would eventually make prompt redaction fail).
import { Vault } from "../engine/vault.js";

export const MAX_GUARD_ENTRIES = 2000;

// items: Array<{ original, category, style }>. Returns the new guard state.
export function assignGuardStandIns(guardState, persistentState, items) {
  const guard = new Vault(guardState);
  const persistent = persistentState ?? {};
  const taken = (s) => persistent.byStandIn?.[s] !== undefined;
  for (const { original, category, style } of items) {
    if (persistent.byOriginal?.[original] !== undefined) continue;
    if (guard.byOriginal[original] !== undefined) continue;
    if (Object.keys(guard.byOriginal).length >= MAX_GUARD_ENTRIES) break;
    guard.standInFor(original, category, style, taken);
  }
  return guard.toJSON();
}
