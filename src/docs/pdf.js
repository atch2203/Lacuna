// PDF redaction: rasterize each page (with stand-ins painted over sensitive
// spans) and add an invisible text layer holding the redacted text, so the
// page looks like the original but no original text survives anywhere.
//
// Renderer = (page, viewport, paints: Array<{x, y, w, h, standIn, fontPx}>)
//            => Promise<Uint8Array /* JPEG */>
// standIn is "" for continuation pieces of a span that crosses text items
// (fill only, no text).
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { buildPageText, spanPieces, pieceBox, itemTexts } from "./pdf-layout.js";

const MAX_PAGES = 100;
const MAX_SCALE = 2;
const MAX_SIDE_PX = 4096;
const PAD_EM = 0.15;
// Glyphs with no Unicode mapping come out of pdf.js as private-use characters
// (Chrome's "Print to PDF" does this for "-" and ":"). Treat them as a
// separator for detection, one-for-one so offsets don't move.
const UNMAPPED = /[\uE000-\uF8FF]/g;

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

function paintsFor(items, ranges, spans, viewportTransform, measure) {
  const paints = [];
  for (const span of spans) {
    spanPieces(ranges, span).forEach((piece, i) => {
      const box = pieceBox(items[piece.item], piece.from, piece.to, viewportTransform, { measure, padEm: PAD_EM });
      paints.push({ ...box, standIn: i === 0 ? span.standIn : "", fontPx: box.h });
    });
  }
  return paints;
}

// measure(str) (optional): text width for proportional box offsets.
// onProgress({ page, pages }) (optional): called after each page is built.
// Renderers must not draw annotations/form fields: their appearances aren't
// in the text layer, so they can't be redacted (a warning is returned).
// skipIfClean: when no span is found anywhere, return { status: "clean" } with
// the original bytes instead of rebuilding (used when restoring files).
export async function redactPdf(bytes, redactSpans, { pdfjs, render, measure, onProgress, skipIfClean = false, docOptions = {} }) {
  // pdf.js may transfer (detach) the buffer it's given; hand it a copy.
  const task = pdfjs.getDocument({ ...docOptions, data: bytes.slice(), verbosity: 0 });
  const src = await task.promise;
  try {
    if (src.numPages > MAX_PAGES) throw new Error(`pdf has more than ${MAX_PAGES} pages`);

    const pages = [];
    let annotations = 0;
    for (let n = 1; n <= src.numPages; n++) {
      const page = await src.getPage(n);
      const { items } = await page.getTextContent();
      const textItems = items.filter((it) => typeof it.str === "string");
      annotations += (await page.getAnnotations()).filter((a) => a.subtype !== "Link").length;
      pages.push({ page, items: textItems, ...buildPageText(textItems) });
    }
    // Still rebuild when there are annotations, so form fields get removed.
    if (!annotations && pages.every((p) => p.text.trim() === "")) return { status: "no-text", bytes, count: 0 };

    const allSpans = await redactSpans(pages.map((p) => p.text.replace(UNMAPPED, "-")));
    const unmapped = pages.reduce((n, p) => n + (p.text.match(UNMAPPED)?.length ?? 0), 0);
    if (skipIfClean && allSpans.every((s) => s.length === 0)) return { status: "clean", bytes, count: 0 };

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
      // Render unrotated; the output page carries the original /Rotate, so
      // page size, boxes and hidden text all stay in unrotated coordinates.
      const viewport = page.getViewport({ scale, rotation: 0 });

      const jpeg = await render(page, viewport, paintsFor(items, ranges, spans, viewport.transform, measure));
      const image = await out.embedJpg(jpeg);
      const outPage = out.addPage([width, height]);
      outPage.drawImage(image, { x: 0, y: 0, width, height });
      if (page.rotate) outPage.setRotation(degrees(page.rotate));

      itemTexts(text, ranges, spans).forEach((str, j) => {
        if (!str.trim()) return;
        const [a, b, c, d, tx, ty] = items[j].transform;
        outPage.drawText(hiddenText(str, font), {
          x: tx - x0,
          y: ty - y0,
          size: Math.hypot(c, d) || items[j].height || 10,
          rotate: degrees((Math.atan2(b, a) * 180) / Math.PI),
          font,
          opacity: 0,
        });
      });
      page.cleanup();
      onProgress?.({ page: i + 1, pages: pages.length });
    }

    const warnings = [];
    if (annotations) {
      warnings.push(`${annotations} form field${annotations === 1 ? "" : "s"}/annotation${annotations === 1 ? "" : "s"} removed (not redactable)`);
    }
    if (unmapped) {
      warnings.push(`${unmapped} character${unmapped === 1 ? "" : "s"} couldn't be read reliably — check the preview for unredacted values`);
    }
    return { bytes: await out.save(), count, warnings };
  } finally {
    await task.destroy();
  }
}
