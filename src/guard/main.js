// MAIN-world entry (all sites, all frames): report screen shares started
// from this page to the ISOLATED guard script, and announce shadow roots
// attached after load so the guard can observe them.
import { installShareDetector } from "./share-detector.js";

if (navigator.mediaDevices?.getDisplayMedia && typeof MediaStreamTrack !== "undefined") {
  installShareDetector({
    mediaDevices: navigator.mediaDevices,
    trackProto: MediaStreamTrack.prototype,
    report: (r) => window.postMessage({ source: "llm-redactor-share", ...r }, "*"),
  });
}

const originalAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (...args) {
  const root = originalAttachShadow.apply(this, args);
  if (root.mode === "open") {
    // After the page has had a chance to fill it.
    queueMicrotask(() =>
      this.dispatchEvent(new CustomEvent("llm-redactor-shadow-attached", { bubbles: true, composed: true })),
    );
  }
  return root;
};
