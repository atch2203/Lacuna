// DOM wiring for the screen-share guard: rewrites sensitive text in place
// while a share is active, and restores it afterwards.
//
// Safety rules (see design §3):
// - only text nodes' nodeValue is written; no nodes added, removed or split
// - editable fields are never rewritten: text boxes (input/textarea) get a
//   mirror overlay showing stand-ins while their own text is transparent;
//   rich editors (contenteditable) are blurred
// - mutations are handled synchronously in the observer callback (a
//   microtask, before the next paint), so originals are never painted
// - open shadow roots are scanned and observed too; roots attached later are
//   announced by the MAIN-world script via "llm-redactor-shadow-attached"
import { createNodeGuard } from "./node-guard.js";
import { guardText } from "./guard-text.js";
import { findSensitive } from "../engine/redact.js";

const EDITABLE = "input, textarea, [contenteditable]:not([contenteditable='false'])";
const SKIP = `script, style, noscript, ${EDITABLE}, [data-llm-redactor]`;
const SHADOW_EVENT = "llm-redactor-shadow-attached";
const BLUR = "blur(6px)";
const OBSERVE = { childList: true, subtree: true, characterData: true };

// getDetectors() → Detector[]; lookup(original) → standIn | undefined;
// isStandIn(text) → boolean; requestStandIns(items[]) asks for stand-ins.
export function startScreenGuard({ getDetectors, lookup, isStandIn = () => false, requestStandIns, root = document.documentElement }) {
  const nodes = createNodeGuard({ transform: (text) => guardText(text, getDetectors(), lookup, isStandIn) });
  const observedRoots = new WeakSet();
  const blurred = new Map(); // element → previous inline filter (value, priority)

  // Batch stand-in requests: one per microtask turn, deduped by original.
  const queued = new Map();
  let flushScheduled = false;
  function want(pending) {
    for (const p of pending) queued.set(p.original, p);
    if (!queued.size || flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const items = [...queued.values()];
      queued.clear();
      if (items.length) requestStandIns(items);
    });
  }

  function setBlur(el, on) {
    if (on && !blurred.has(el)) {
      blurred.set(el, [el.style.getPropertyValue("filter"), el.style.getPropertyPriority("filter")]);
      el.style.setProperty("filter", BLUR, "important");
    } else if (!on && blurred.has(el)) {
      const [value, priority] = blurred.get(el);
      blurred.delete(el);
      if (value) el.style.setProperty("filter", value, priority);
      else el.style.removeProperty("filter");
    }
  }

  // --- Text-box mirrors -------------------------------------------------------
  const mirrors = new Map(); // field → { el, saved: [[prop, value, priority]] }
  const MIRRORED_STYLES = [
    "font", "letter-spacing", "word-spacing", "line-height", "text-align", "text-indent", "text-transform",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "box-sizing",
  ];

  function hideFieldText(field) {
    const color = getComputedStyle(field).color;
    const saved = ["color", "caret-color", "-webkit-text-fill-color"].map((p) => [
      p,
      field.style.getPropertyValue(p),
      field.style.getPropertyPriority(p),
    ]);
    field.style.setProperty("color", "transparent", "important");
    field.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    field.style.setProperty("caret-color", color, "important");
    return { saved, color };
  }

  function removeMirror(field) {
    const m = mirrors.get(field);
    if (!m) return;
    mirrors.delete(field);
    m.el.remove();
    for (const [prop, value, priority] of m.saved) {
      if (value) field.style.setProperty(prop, value, priority);
      else field.style.removeProperty(prop);
    }
  }

  function positionMirror(field, m) {
    const r = field.getBoundingClientRect();
    const cs = getComputedStyle(field);
    const st = m.el.style;
    for (const p of MIRRORED_STYLES) st.setProperty(p, cs.getPropertyValue(p));
    st.setProperty("border-style", "solid");
    st.setProperty("border-color", "transparent");
    st.setProperty("left", `${r.left}px`);
    st.setProperty("top", `${r.top}px`);
    st.setProperty("width", `${r.width}px`);
    st.setProperty("height", `${r.height}px`);
    st.setProperty("visibility", r.width && r.height ? "visible" : "hidden");
    m.el.scrollTop = field.scrollTop;
    m.el.scrollLeft = field.scrollLeft;
  }

  function updateMirror(field) {
    const out = guardText(field.value ?? "", getDetectors(), lookup, isStandIn);
    want(out.pending);
    if (!out.changed) {
      removeMirror(field);
      return;
    }
    let m = mirrors.get(field);
    if (!m) {
      const el = document.createElement("div");
      el.setAttribute("data-llm-redactor", "mirror");
      const { saved, color } = hideFieldText(field);
      const textarea = field.matches("textarea");
      el.style.cssText =
        `position:fixed; margin:0; overflow:hidden; pointer-events:none; z-index:2147483646; ` +
        `background:transparent; color:${color}; white-space:${textarea ? "pre-wrap" : "pre"}; ` +
        `overflow-wrap:${textarea ? "break-word" : "normal"};`;
      document.documentElement.appendChild(el);
      m = { el, saved };
      mirrors.set(field, m);
    }
    if (m.el.textContent !== out.text) m.el.textContent = out.text;
    positionMirror(field, m);
  }

  function checkField(el) {
    if (!el) return;
    if (el.matches("input, textarea")) {
      if (el.type === "password" || el.type === "hidden") return;
      updateMirror(el);
      return;
    }
    setBlur(el, findSensitive(el.textContent ?? "", getDetectors()).length > 0);
  }

  function processText(textNode) {
    const parent = textNode.parentElement;
    if (!parent) return;
    if (parent.closest(SKIP)) {
      const editable = parent.closest(EDITABLE);
      if (editable) checkField(editable);
      return;
    }
    want(nodes.process(textNode));
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") processText(r.target);
      else for (const n of r.addedNodes) processSubtree(n);
    }
  });

  function observeShadow(host) {
    const shadow = host.shadowRoot;
    if (!shadow || observedRoots.has(shadow)) return;
    observedRoots.add(shadow);
    processSubtree(shadow);
    observer.observe(shadow, OBSERVE);
  }

  function processSubtree(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      processText(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) processText(t);
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches(EDITABLE)) checkField(node);
      if (node.shadowRoot) observeShadow(node);
    }
    node.querySelectorAll?.(EDITABLE).forEach(checkField);
    node.querySelectorAll?.("*").forEach((el) => el.shadowRoot && observeShadow(el));
  }

  function onInput(event) {
    const field = event.composedPath?.()[0]?.closest?.(EDITABLE) ?? event.target?.closest?.(EDITABLE);
    if (field) checkField(field);
  }

  function onShadowAttached(event) {
    const host = event.composedPath?.()[0] ?? event.target;
    if (host?.shadowRoot) observeShadow(host);
  }

  // Values set from code fire no events: re-check fields before every paint.
  let frame = 0;
  const fields = () => [...root.querySelectorAll("input, textarea"), ...blurred.keys(), ...mirrors.keys()];
  function tick() {
    for (const el of new Set(fields())) {
      if (!el.isConnected) removeMirror(el);
      else checkField(el);
    }
    frame = requestAnimationFrame(tick);
  }

  processSubtree(root);
  observer.observe(root, OBSERVE);
  window.addEventListener("input", onInput, true);
  window.addEventListener(SHADOW_EVENT, onShadowAttached, true);
  frame = requestAnimationFrame(tick);

  return {
    vaultChanged() {
      want(nodes.reprocessAll());
      for (const el of [...mirrors.keys()]) updateMirror(el);
    },
    stop() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("input", onInput, true);
      window.removeEventListener(SHADOW_EVENT, onShadowAttached, true);
      nodes.restoreAll();
      for (const el of [...blurred.keys()]) setBlur(el, false);
      for (const el of [...mirrors.keys()]) removeMirror(el);
    },
  };
}
