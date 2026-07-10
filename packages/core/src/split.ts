import { PDFDocument } from 'pdf-lib';
import { zipSync } from 'fflate';
import { loadPdf, PdfUserError } from './load';

/**
 * Parse a 1-based page-range string like "1-3,5,8-10" into 0-based page indices.
 * Throws PdfUserError with an actionable message when out of bounds or malformed.
 */
export function parsePageRanges(rangeStr: string, pageCount: number): number[] {
  const indices: number[] = [];
  const trimmed = rangeStr.trim();
  if (!trimmed) {
    throw new PdfUserError('Enter a page range, e.g. "1-3,5,8-10".', 'invalid-range');
  }
  for (const part of trimmed.split(',')) {
    const piece = part.trim();
    const m = piece.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) {
      throw new PdfUserError(
        `"${piece}" is not a valid page or range — use forms like "5" or "8-10".`,
        'invalid-range',
      );
    }
    const start = parseInt(m[1]!, 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end > pageCount || start > end) {
      throw new PdfUserError(
        `Page range ${piece} is invalid — this document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
        'invalid-range',
      );
    }
    for (let p = start; p <= end; p++) indices.push(p - 1);
  }
  return indices;
}

/** Extract the pages matching a range string into a new PDF. */
export async function splitByRange(bytes: Uint8Array, rangeStr: string): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const indices = parsePageRanges(rangeStr, src.getPageCount());
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  return out.save({ useObjectStreams: true });
}

/**
 * Split into one single-page PDF per page, returned as a zip archive
 * (one download instead of N save dialogs). Entry names: `<baseName>-page-<n>.pdf`.
 */
export async function splitToSinglePages(
  bytes: Uint8Array,
  baseName: string,
): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < src.getPageCount(); i++) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(src, [i]);
    out.addPage(page!);
    entries[`${baseName}-page-${i + 1}.pdf`] = await out.save({ useObjectStreams: true });
  }
  return zipSync(entries, { level: 0 }); // PDFs are already compressed; store, don't deflate
}
