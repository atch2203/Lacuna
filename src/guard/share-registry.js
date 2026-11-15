// Which screen shares are active, and whether the guard should be on. Pure.
//
// State = { shares: { "<tabId>:<shareId>": surface }, manual: boolean }

export function initialState() {
  return { shares: {}, manual: false };
}

function withoutTab(shares, tabId) {
  const prefix = `${tabId}:`;
  return Object.fromEntries(Object.entries(shares).filter(([key]) => !key.startsWith(prefix)));
}

export function reduce(state, event) {
  switch (event.type) {
    case "share-started":
      return { ...state, shares: { ...state.shares, [`${event.tabId}:${event.shareId}`]: event.surface } };
    case "share-ended": {
      const key = `${event.tabId}:${event.shareId}`;
      if (!(key in state.shares)) return state;
      const { [key]: _gone, ...shares } = state.shares;
      return { ...state, shares };
    }
    case "share-reset":
    case "tab-removed":
      return { ...state, shares: withoutTab(state.shares, event.tabId) };
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
