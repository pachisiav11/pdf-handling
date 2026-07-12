import { StandardFonts, rgb } from 'pdf-lib';
import { loadPdf } from '../load';
import type { CanvasEncoder } from './pdfToImage';
import { ocrPdf, type OcrOptions, type OcrPageResult } from './ocr';

/**
 * Searchable-OCR upgrade (build guide v1.1). Takes word-level OCR results and
 * draws an INVISIBLE text layer (rendered at opacity 0 — the PDF "Tr 3" render
 * mode analogue pdf-lib exposes) over each recognized page, positioned by the
 * word bounding boxes. The page looks identical but the text is now
 * selectable/searchable/copyable.
 *
 * `pages` bboxes are in PDF points measured from the TOP-LEFT (as ocrPdf
 * returns them); we flip to pdf-lib's bottom-left origin here using each page's
 * real height.
 */
export async function addSearchableTextLayer(
  bytes: Uint8Array,
  pages: OcrPageResult[],
  opts: { minConfidence?: number } = {},
): Promise<Uint8Array> {
  const minConfidence = opts.minConfidence ?? 0;
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const invisible = rgb(0, 0, 0);

  for (const page of pages) {
    if (page.pageIndex < 0 || page.pageIndex >= doc.getPageCount()) continue;
    const p = doc.getPage(page.pageIndex);
    const pageHeight = p.getHeight();

    for (const w of page.words) {
      const text = w.text?.trim();
      if (!text || w.confidence < minConfidence) continue;
      const size = Math.max(1, w.bbox.height * 0.8);
      // top-left box → bottom-left baseline (roughly the box bottom)
      const y = pageHeight - w.bbox.y - w.bbox.height;
      p.drawText(text, {
        x: w.bbox.x,
        y,
        size,
        font,
        color: invisible,
        opacity: 0, // invisible but present in the content stream → selectable
      });
    }
  }

  return doc.save({ useObjectStreams: true });
}

/**
 * One-shot: OCR a (scanned) PDF and return a copy with an invisible, searchable
 * text layer baked in. Convenience wrapper over {@link ocrPdf} +
 * {@link addSearchableTextLayer}.
 */
export async function ocrToSearchablePdf(
  bytes: Uint8Array,
  opts: OcrOptions,
  encoder: CanvasEncoder,
): Promise<Uint8Array> {
  const results = await ocrPdf(bytes, opts, encoder);
  return addSearchableTextLayer(bytes, results);
}
