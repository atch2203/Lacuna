// MAIN-world entry (all sites, all frames): report screen shares started
// from this page to the ISOLATED guard script.
import { installShareDetector } from "./share-detector.js";

if (navigator.mediaDevices?.getDisplayMedia && typeof MediaStreamTrack !== "undefined") {
  installShareDetector({
    mediaDevices: navigator.mediaDevices,
    trackProto: MediaStreamTrack.prototype,
    report: (r) => window.postMessage({ source: "llm-redactor-share", ...r }, "*"),
  });
}
