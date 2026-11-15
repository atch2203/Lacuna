// PDF redaction: rasterize each page (with stand-ins painted over sensitive
// spans) and add an invisible text layer holding the redacted text, so the
// page looks like the original but no original text survives anywhere.
//
// Renderer = (page, viewport, paints: Array<{x, y, w, h, standIn, fontPx}>)
//            => Promise<Uint8Array /* JPEG */>
// standIn is "" for continuation pieces of a span that crosses text items
// (fill only, no text).
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildPageText, spanPieces, pieceBox, itemTexts } from "./pdf-layout.js";

const MAX_PAGES = 100;
const MAX_SCALE = 2;
const MAX_SIDE_PX = 4096;

// Characters the font can't encode become "?" (hidden layer only).
export function hiddenText(str, font) {
  let out = "";
  for (const ch of str) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function paintsFor(items, ranges, spans, viewportTransform) {
  const paints = [];
  for (const span of spans) {
    spanPieces(ranges, span).forEach((piece, i) => {
      const box = pieceBox(items[piece.item], piece.from, piece.to, viewportTransform);
      paints.push({ ...box, standIn: i === 0 ? span.standIn : "", fontPx: box.h });
    });
  }
  return paints;
}

export async function redactPdf(bytes, redactSpans, { pdfjs, render }) {
  // pdf.js may transfer (detach) the buffer it's given; hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const src = await task.promise;
  try {
    if (src.numPages > MAX_PAGES) throw new Error(`pdf has more than ${MAX_PAGES} pages`);

    const pages = [];
    for (let n = 1; n <= src.numPages; n++) {
      const page = await src.getPage(n);
      const { items } = await page.getTextContent();
      const textItems = items.filter((it) => typeof it.str === "string");
      pages.push({ page, items: textItems, ...buildPageText(textItems) });
    }
    if (pages.every((p) => p.text.trim() === "")) return { status: "no-text", bytes, count: 0 };

    const allSpans = await redactSpans(pages.map((p) => p.text));

    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    let count = 0;

    for (const [i, { page, items, text, ranges }] of pages.entries()) {
      const spans = allSpans[i];
      count += spans.length;

      const [x0, y0, x1, y1] = page.view;
      const width = x1 - x0;
      const height = y1 - y0;
      const scale = Math.min(MAX_SCALE, MAX_SIDE_PX / Math.max(width, height));
      const viewport = page.getViewport({ scale });

      const jpeg = await render(page, viewport, paintsFor(items, ranges, spans, viewport.transform));
      const image = await out.embedJpg(jpeg);
      const outPage = out.addPage([width, height]);
      outPage.drawImage(image, { x: 0, y: 0, width, height });

      itemTexts(text, ranges, spans).forEach((str, j) => {
        if (!str.trim()) return;
        const [, , c, d, tx, ty] = items[j].transform;
        outPage.drawText(hiddenText(str, font), {
          x: tx - x0,
          y: ty - y0,
          size: Math.hypot(c, d) || items[j].height || 10,
          font,
          opacity: 0,
        });
      });
    }

    return { bytes: await out.save(), count };
  } finally {
    await task.destroy();
  }
}
