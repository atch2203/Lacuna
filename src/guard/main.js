// MAIN-world entry (all sites, all frames): report screen shares started
// from this page to the ISOLATED guard script, and announce shadow roots
// attached after load so the guard can observe them.
import { installShareDetector } from "./share-detector.js";
import { wrapClipboard } from "../demo/clipboard.js";

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

// Ghost clipboard: site copy buttons go through the extension, which writes
// real values itself. Only a yes/no comes back here (never restored text).
const CLIP = "llm-redactor-clip";
if (navigator.clipboard) {
  wrapClipboard(navigator.clipboard, (request) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(false), 1500);
      function done(handled) {
        clearTimeout(timer);
        window.removeEventListener("message", onAck);
        resolve(handled);
      }
      function onAck(event) {
        const msg = event.data;
        if (event.source === window && msg?.source === CLIP && msg.type === "ack" && msg.id === id) done(Boolean(msg.handled));
      }
      window.addEventListener("message", onAck);
      window.postMessage({ source: CLIP, type: "write", id, request }, "*");
    });
  });
}
