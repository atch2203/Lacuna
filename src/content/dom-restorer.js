// Swaps stand-ins back to originals in rendered text nodes.

const SKIP_SELECTOR = [
  '[contenteditable]:not([contenteditable="false"])',
  "textarea",
  "input",
  "script",
  "style",
  "noscript",
  "[data-llm-redactor]",
].join(",");

function shouldSkip(textNode) {
  const parent = textNode.parentElement;
  return !parent || parent.closest(SKIP_SELECTOR) !== null;
}

// getRestore: () => (text) => string. Called on every pass so callers can
// swap in a new restorer when the vault changes.
export function startDomRestorer({ getRestore, root = document.documentElement }) {
  const pending = new Set();
  let scheduled = false;

  function restoreTextNode(node, restore) {
    if (shouldSkip(node)) return;
    const value = node.nodeValue;
    const restored = restore(value);
    // Only write on change: this is also the re-entrancy guard, since a
    // restored node no longer contains any stand-in.
    if (restored !== value) node.nodeValue = restored;
  }

  function restoreSubtree(node, restore) {
    if (node.nodeType === Node.TEXT_NODE) {
      restoreTextNode(node, restore);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) restoreTextNode(t, restore);
  }

  function flush() {
    scheduled = false;
    const restore = getRestore();
    for (const node of pending) {
      if (node.isConnected) restoreSubtree(node, restore);
    }
    pending.clear();
  }

  function schedule(node) {
    pending.add(node);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") schedule(r.target);
      else for (const n of r.addedNodes) schedule(n);
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });

  schedule(root);

  return {
    refresh() {
      schedule(root);
    },
    stop() {
      observer.disconnect();
      pending.clear();
    },
  };
}
