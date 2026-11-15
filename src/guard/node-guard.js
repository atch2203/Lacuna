// Bookkeeping for guarded text nodes: remembers each node's original text and
// what we wrote, so we can re-guard after page re-renders and restore later
// without clobbering text the page changed in the meantime.
//
// transform(text) → { text, pending: string[], changed }

export function createNodeGuard({ transform }) {
  const tracked = new Map(); // node → { original, applied }

  function guardFrom(node, original) {
    const out = transform(original);
    if (!out.changed) {
      tracked.delete(node);
      return out.pending;
    }
    tracked.set(node, { original, applied: out.text });
    if (node.nodeValue !== out.text) node.nodeValue = out.text;
    return out.pending;
  }

  return {
    // Returns originals that still need a stand-in.
    process(node) {
      const entry = tracked.get(node);
      if (entry && node.nodeValue === entry.applied) return [];
      // New node, or the page replaced our text: its current value is the original.
      return guardFrom(node, node.nodeValue);
    },

    // Re-run every tracked node from its original (e.g. after new stand-ins
    // were assigned). Forgets nodes that left the document.
    reprocessAll() {
      const pending = [];
      for (const [node, entry] of [...tracked]) {
        if (node.isConnected === false) {
          tracked.delete(node);
          continue;
        }
        if (node.nodeValue !== entry.applied) continue; // page changed it; next process() handles it
        pending.push(...guardFrom(node, entry.original));
      }
      return pending;
    },

    restoreAll() {
      for (const [node, entry] of tracked) {
        if (node.nodeValue === entry.applied) node.nodeValue = entry.original;
      }
      tracked.clear();
    },
  };
}
