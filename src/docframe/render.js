// OffscreenCanvas page renderer for redactPdf: draws the page, covers each
// sensitive span with its surrounding background color, writes the stand-in.

const JPEG_QUALITY = 0.92;

// Median color of the 1px ring just outside the box.
function borderColor(ctx, { x, y, w, h }, width, height) {
  const x0 = Math.max(0, Math.floor(x) - 1);
  const y0 = Math.max(0, Math.floor(y) - 1);
  const x1 = Math.min(width - 1, Math.ceil(x + w));
  const y1 = Math.min(height - 1, Math.ceil(y + h));
  const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  const samples = [[], [], []];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r !== 0 && r !== rows - 1 && c !== 0 && c !== cols - 1) continue;
      const i = (r * cols + c) * 4;
      for (let k = 0; k < 3; k++) samples[k].push(data.data[i + k]);
    }
  }
  const median = (a) => a.sort((p, q) => p - q)[a.length >> 1] ?? 255;
  return samples.map(median);
}

// Width of str in a generic sans-serif face; used for proportional offsets
// of sensitive spans within a text item (close to Helvetica/Arial metrics).
const measureCtx = new OffscreenCanvas(1, 1).getContext("2d");
measureCtx.font = "100px sans-serif";
export function measureText(str) {
  return measureCtx.measureText(str).width;
}

export async function renderPage(page, viewport, paints) {
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  // intent "print": the display intent paces rendering with
  // requestAnimationFrame, which never fires in a display:none iframe (or a
  // background tab), so the render promise would never resolve.
  await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;

  for (const p of paints) {
    const [r, g, b] = borderColor(ctx, p, width, height);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    // Boxes run baseline→ascent; extend below the baseline for descenders
    // (p, g, y) and by 1px all round for antialiasing.
    ctx.fillRect(p.x - 1, p.y - 1, p.w + 2, p.h * 1.25 + 2);
    if (!p.standIn) continue;

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    ctx.fillStyle = luminance > 128 ? "#000000" : "#ffffff";
    const fontPx = Math.max(6, p.fontPx * 0.85);
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textBaseline = "alphabetic";
    const measured = ctx.measureText(p.standIn).width || 1;
    const squeeze = Math.min(1, p.w / measured);
    ctx.save();
    ctx.translate(p.x, p.y + p.h * 0.82);
    ctx.scale(squeeze, 1);
    ctx.fillText(p.standIn, 0, 0);
    ctx.restore();
  }

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return new Uint8Array(await blob.arrayBuffer());
}
