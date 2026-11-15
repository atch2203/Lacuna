import { test } from "node:test";
import assert from "node:assert/strict";
import { installShareDetector } from "../src/guard/share-detector.js";

function setup({ reject = false, kinds = ["video"] } = {}) {
  const stopCalls = [];
  class FakeTrack extends EventTarget {
    constructor(kind) {
      super();
      this.kind = kind;
    }
    getSettings() {
      return { displaySurface: "window" };
    }
    stop() {
      stopCalls.push(this.kind);
    }
  }
  const tracks = kinds.map((k) => new FakeTrack(k));
  const mediaDevices = {
    getDisplayMedia: async () => {
      if (reject) throw new Error("NotAllowedError");
      return { getTracks: () => tracks };
    },
  };
  const reports = [];
  let n = 0;
  installShareDetector({ mediaDevices, trackProto: FakeTrack.prototype, report: (r) => reports.push(r), newId: () => `s${++n}` });
  return { mediaDevices, tracks, reports, stopCalls };
}

test("start is reported with the display surface", async () => {
  const { mediaDevices, reports } = setup();
  await mediaDevices.getDisplayMedia({ video: true });
  assert.deepEqual(reports.at(-1), { type: "share-started", shareId: "s1", surface: "window" });
});

test("track 'ended' → share-ended once", async () => {
  const { mediaDevices, tracks, reports } = setup();
  await mediaDevices.getDisplayMedia();
  tracks[0].dispatchEvent(new Event("ended"));
  tracks[0].dispatchEvent(new Event("ended"));
  assert.deepEqual(reports.slice(2), [{ type: "share-ended", shareId: "s1" }]);
});

test("track.stop() (Meet's Stop presenting) → share-ended, original stop still runs", async () => {
  const { mediaDevices, tracks, reports, stopCalls } = setup();
  await mediaDevices.getDisplayMedia();
  tracks[0].stop();
  assert.deepEqual(reports.slice(2), [{ type: "share-ended", shareId: "s1" }]);
  assert.deepEqual(stopCalls, ["video"]);
});

test("ended after stop → still one share-ended", async () => {
  const { mediaDevices, tracks, reports } = setup();
  await mediaDevices.getDisplayMedia();
  tracks[0].stop();
  tracks[0].dispatchEvent(new Event("ended"));
  assert.equal(reports.filter((r) => r.type === "share-ended").length, 1);
});

test("rejected getDisplayMedia → rejects; pending share is ended", async () => {
  const { mediaDevices, reports } = setup({ reject: true });
  await assert.rejects(mediaDevices.getDisplayMedia(), /NotAllowedError/);
  assert.deepEqual(reports, [
    { type: "share-started", shareId: "s1", surface: "pending" },
    { type: "share-ended", shareId: "s1" },
  ]);
});

test("audio tracks are ignored", async () => {
  const { mediaDevices, tracks, reports } = setup({ kinds: ["video", "audio"] });
  await mediaDevices.getDisplayMedia();
  tracks[1].stop();
  assert.equal(reports.filter((r) => r.type === "share-ended").length, 0);
});

test("share detection works without a MediaStreamTrack prototype", async () => {
  const reports = [];
  const mediaDevices = {
    getDisplayMedia: async () => ({
      getTracks: () => [{ kind: "video", getSettings: () => ({ displaySurface: "browser" }) }],
    }),
  };
  installShareDetector({ mediaDevices, report: (r) => reports.push(r), newId: () => "s2" });
  await mediaDevices.getDisplayMedia();
  assert.deepEqual(reports, [
    { type: "share-started", shareId: "s2", surface: "pending" },
    { type: "share-started", shareId: "s2", surface: "browser" },
  ]);
});

test("stop on an untracked track (e.g. camera) reports nothing", async () => {
  const { reports, tracks } = setup();
  const Camera = Object.getPrototypeOf(tracks[0]).constructor;
  new Camera("video").stop();
  assert.deepEqual(reports, []);
});
