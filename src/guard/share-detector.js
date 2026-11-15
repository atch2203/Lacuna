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

  if (trackProto?.stop) {
    const originalStop = trackProto.stop;
    trackProto.stop = function (...args) {
      end(this);
      return originalStop.apply(this, args);
    };
  }

  // The share is reported as soon as the picker opens ("pending"), so the
  // guard is already on when capture starts; cancelling ends it.
  const originalGetDisplayMedia = mediaDevices.getDisplayMedia;
  mediaDevices.getDisplayMedia = async function (...args) {
    const share = { shareId: newId(), ended: false };
    report({ type: "share-started", shareId: share.shareId, surface: "pending" });
    let stream;
    try {
      stream = await originalGetDisplayMedia.apply(this, args);
    } catch (err) {
      share.ended = true;
      report({ type: "share-ended", shareId: share.shareId });
      throw err;
    }
    const video = stream.getTracks().filter((t) => t.kind === "video");
    for (const track of video) {
      shareOf.set(track, share);
      track.addEventListener?.("ended", () => end(track));
    }
    const surface = video[0]?.getSettings?.().displaySurface ?? "unknown";
    report({ type: "share-started", shareId: share.shareId, surface });
    return stream;
  };
}
