import { PDFDocument } from 'pdf-lib';
import { loadPdf } from './load';

export type PaperSize = 'a4' | 'letter';

/** Target page dimensions in PDF points (portrait). */
const PAGE_DIMS: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

/**
 * Rescale every page to a uniform target size (build guide "Page size
 * normalize"). Each source page is embedded into a new fixed-size page and
 * centered, scaled to fit within the target while preserving aspect ratio. The
 * target orientation follows each source page (landscape source → landscape
 * target of the same paper size), so a mixed-orientation document stays sane.
 * Offered standalone and as a merge checkbox.
 */
export async function normalizePageSize(bytes: Uint8Array, size: PaperSize): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const out = await PDFDocument.create();
  const base = PAGE_DIMS[size];
  const pageCount = src.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    const embedded = await out.embedPage(src.getPage(i));
    const srcPage = src.getPage(i);
    const { width: sw, height: sh } = srcPage.getSize();

    // Match target orientation to the source page's orientation.
    const landscape = sw > sh;
    const targetW = landscape ? base.height : base.width;
    const targetH = landscape ? base.width : base.height;

    const scale = Math.min(targetW / sw, targetH / sh);
    const drawW = sw * scale;
    const drawH = sh * scale;
    const x = (targetW - drawW) / 2;
    const y = (targetH - drawH) / 2;

    const page = out.addPage([targetW, targetH]);
    page.drawPage(embedded, { x, y, width: drawW, height: drawH });
  }

  return out.save({ useObjectStreams: true });
}
