// Bookkeeping for guarded text nodes: remembers each node's original text and
// what we wrote, so we can re-guard after page re-renders and restore later
// without clobbering text the page changed in the meantime.
//
// Entries live in a WeakMap (no leaks for removed nodes) plus a Set of
// WeakRefs for iteration. Detached nodes are kept, not forgotten, so a node
// that's re-attached later still restores to its real original.
//
// transform(text) → { text, pending, changed }

export function createNodeGuard({ transform }) {
  const entries = new WeakMap(); // node → { original, applied }
  const refs = new Set(); // WeakRef<node>

  function track(node, entry) {
    if (!entries.has(node)) refs.add(new WeakRef(node));
    entries.set(node, entry);
  }

  function guardFrom(node, original) {
    const out = transform(original);
    if (!out.changed) {
      entries.delete(node);
      return out.pending;
    }
    track(node, { original, applied: out.text });
    if (node.nodeValue !== out.text) node.nodeValue = out.text;
    return out.pending;
  }

  function* live() {
    for (const ref of refs) {
      const node = ref.deref();
      const entry = node && entries.get(node);
      if (!entry) {
        refs.delete(ref);
        continue;
      }
      yield [node, entry];
    }
  }

  return {
    // Returns pending items (values that still need a stand-in).
    process(node) {
      const entry = entries.get(node);
      if (entry && node.nodeValue === entry.applied) return [];
      return guardFrom(node, node.nodeValue);
    },

    // Re-run tracked, attached nodes from their originals (e.g. after new
    // stand-ins were assigned). Detached nodes are skipped, not dropped.
    reprocessAll() {
      const pending = [];
      for (const [node, entry] of live()) {
        if (node.isConnected === false || node.nodeValue !== entry.applied) continue;
        pending.push(...guardFrom(node, entry.original));
      }
      return pending;
    },

    restoreAll() {
      for (const [node, entry] of live()) {
        if (node.nodeValue === entry.applied) node.nodeValue = entry.original;
        entries.delete(node);
      }
      refs.clear();
    },
  };
}
