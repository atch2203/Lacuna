// DOM wiring for the screen-share guard: rewrites sensitive text in place
// while a share is active, and restores it afterwards.
//
// Safety rules (see design §3):
// - only text nodes' nodeValue is written; no nodes added, removed or split
// - editable fields are never rewritten; sensitive ones are blurred instead
// - mutations are handled synchronously in the observer callback (a
//   microtask, before the next paint), so originals are never painted
import { createNodeGuard } from "./node-guard.js";
import { guardText } from "./guard-text.js";
import { findSensitive } from "../engine/redact.js";

const EDITABLE = "input, textarea, [contenteditable]:not([contenteditable='false'])";
const SKIP = `script, style, noscript, ${EDITABLE}, [data-llm-redactor]`;
const BLUR_ATTR = "data-llm-redactor-blur";
const STYLE_TEXT = `[${BLUR_ATTR}] { filter: blur(6px) !important; }`;

// getDetectors() → Detector[]; lookup(original) → standIn | undefined;
// requestStandIns(originals[]) asks the service worker to assign stand-ins.
export function startScreenGuard({ getDetectors, lookup, requestStandIns, root = document.documentElement }) {
  const nodes = createNodeGuard({ transform: (text) => guardText(text, getDetectors(), lookup) });

  // Batch stand-in requests: one per microtask turn.
  const queued = new Set();
  let flushScheduled = false;
  function want(pending) {
    for (const o of pending) queued.add(o);
    if (!queued.size || flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const originals = [...queued];
      queued.clear();
      if (originals.length) requestStandIns(originals);
    });
  }

  function checkField(el) {
    if (!el) return;
    const value = el.matches("input, textarea") ? el.value : el.textContent;
    const sensitive = findSensitive(value ?? "", getDetectors()).length > 0;
    el.toggleAttribute(BLUR_ATTR, sensitive);
  }

  function processText(textNode) {
    const parent = textNode.parentElement;
    if (!parent) return;
    if (parent.closest(SKIP)) {
      // Typing inside a rich editor: re-check the editor's blur.
      const editable = parent.closest(EDITABLE);
      if (editable) checkField(editable);
      return;
    }
    want(nodes.process(textNode));
  }

  function processSubtree(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      processText(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) processText(t);
    if (node.nodeType === Node.ELEMENT_NODE && node.matches(EDITABLE)) checkField(node);
    node.querySelectorAll?.(EDITABLE).forEach(checkField);
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") processText(r.target);
      else for (const n of r.addedNodes) processSubtree(n);
    }
  });

  function onInput(event) {
    const field = event.target?.closest?.(EDITABLE);
    if (field) checkField(field);
  }

  const style = document.createElement("style");
  style.setAttribute("data-llm-redactor", "guard-style");
  style.textContent = STYLE_TEXT;
  (document.head ?? root).appendChild(style);

  processSubtree(root);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  window.addEventListener("input", onInput, true);

  return {
    vaultChanged() {
      want(nodes.reprocessAll());
    },
    stop() {
      observer.disconnect();
      window.removeEventListener("input", onInput, true);
      nodes.restoreAll();
      style.remove();
      root.querySelectorAll(`[${BLUR_ATTR}]`).forEach((el) => el.removeAttribute(BLUR_ATTR));
    },
  };
}
