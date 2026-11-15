// MAIN world: notices screen shares started from this page via
// getDisplayMedia, and when they end. Meeting apps usually stop sharing with
// track.stop(), which does NOT fire "ended", so stop() is wrapped too.

const randomId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function installShareDetector({ mediaDevices, trackProto, report, newId = randomId }) {
  const shareOf = new WeakMap(); // display video track → { shareId, ended }

  function end(track) {
    const share = shareOf.get(track);
    if (!share || share.ended) return;
    share.ended = true;
    report({ type: "share-ended", shareId: share.shareId });
  }

  const originalStop = trackProto.stop;
  trackProto.stop = function (...args) {
    end(this);
    return originalStop.apply(this, args);
  };

  const originalGetDisplayMedia = mediaDevices.getDisplayMedia;
  mediaDevices.getDisplayMedia = async function (...args) {
    const stream = await originalGetDisplayMedia.apply(this, args);
    for (const track of stream.getTracks()) {
      if (track.kind !== "video") continue;
      const share = { shareId: newId(), ended: false };
      shareOf.set(track, share);
      track.addEventListener("ended", () => end(track));
      report({ type: "share-started", shareId: share.shareId, surface: track.getSettings?.().displaySurface ?? "unknown" });
    }
    return stream;
  };
}
