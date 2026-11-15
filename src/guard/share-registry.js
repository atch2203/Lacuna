// Which screen shares are active, and whether the guard should be on. Pure.
//
// State = { shares: { "<tabId>:<frameId>:<shareId>": surface }, manual: boolean }
// Share events come from page scripts and can't be authenticated, so each
// tab may register at most MAX_SHARES_PER_TAB shares.

export const MAX_SHARES_PER_TAB = 4;

export function initialState() {
  return { shares: {}, manual: false };
}

const keyOf = ({ tabId, frameId = 0, shareId }) => `${tabId}:${frameId}:${shareId}`;

function without(shares, prefix) {
  return Object.fromEntries(Object.entries(shares).filter(([key]) => !key.startsWith(prefix)));
}

export function reduce(state, event) {
  switch (event.type) {
    case "share-started": {
      const key = keyOf(event);
      if (!(key in state.shares)) {
        const inTab = Object.keys(state.shares).filter((k) => k.startsWith(`${event.tabId}:`)).length;
        if (inTab >= MAX_SHARES_PER_TAB) return state;
      }
      return { ...state, shares: { ...state.shares, [key]: event.surface } };
    }
    case "share-ended": {
      const key = keyOf(event);
      if (!(key in state.shares)) return state;
      const { [key]: _gone, ...shares } = state.shares;
      return { ...state, shares };
    }
    case "share-reset":
      return { ...state, shares: without(state.shares, `${event.tabId}:${event.frameId ?? 0}:`) };
    case "tab-removed":
      return { ...state, shares: without(state.shares, `${event.tabId}:`) };
    case "manual":
      return { ...state, manual: Boolean(event.on) };
    default:
      return state;
  }
}

export function guardOf(state) {
  if (Object.keys(state.shares).length > 0) return { active: true, reason: "share" };
  if (state.manual) return { active: true, reason: "manual" };
  return { active: false, reason: null };
}
